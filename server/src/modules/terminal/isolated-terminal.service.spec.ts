import type { ConfigService } from '@nestjs/config';
import { IsolatedTerminalService } from './isolated-terminal.service';

const config = (production = false) => ({ getOrThrow: () => ({ enableTerminal: true, terminalBackend: 'isolated', terminalRunnerUrl: 'http://worker:4000', terminalRunnerToken: 'test-token', nodeEnv: production ? 'production' : 'development' }) }) as unknown as ConfigService;
const root = '/untrusted-projection-id';
const id = '00000000-0000-0000-0000-000000000001';
describe('isolated terminal boundary', () => {
  it('rejects a development worker in production before creating any sandbox', async () => {
    const service = new IsolatedTerminalService(config(true));
    const request = jest.spyOn(service, 'request').mockResolvedValue({ isolation: 'local-development-only' });
    await expect(service.create(root, 'workspace', 'user', {}, [])).rejects.toThrow('requires an isolated worker');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { '../outside': 'secret' }, { '/etc/passwd': 'secret' }, { 'a/../../outside': 'secret' },
    { 'a': 42 }, { 'a': 'x'.repeat(1024 * 1024 + 1) }, { 'a': '\0binary' },
  ])('rejects malformed or oversized remote files', async (files) => {
    const service = new IsolatedTerminalService(config());
    const request = jest.spyOn(service, 'request').mockResolvedValueOnce({ isolation: 'gvisor', ready: true }).mockResolvedValueOnce({ id });
    await service.create(root, 'workspace', 'user', {}, []);
    request.mockResolvedValue({ files });
    await expect(service.files(root)).rejects.toThrow();
  });
  it('accepts bounded text snapshots and removes the binding only after successful cleanup', async () => {
    const service = new IsolatedTerminalService(config());
    const request = jest.spyOn(service, 'request').mockResolvedValueOnce({ isolation: 'gvisor', ready: true }).mockResolvedValueOnce({ id });
    await service.create(root, 'workspace', 'user', {}, []);
    request.mockResolvedValueOnce({ files: { 'src/main.py': 'print(42)\n' } });
    expect(await service.files(root)).toEqual(new Map([['src/main.py', 'print(42)\n']]));
    request.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await expect(service.destroy(root)).rejects.toThrow();
    request.mockResolvedValueOnce({ ok: true });
    await service.destroy(root);
    await expect(service.files(root)).rejects.toThrow('unavailable');
  });
});
