import { validate } from 'class-validator';
import {
  TERMINAL_INPUT_MAX_CHARS,
  TerminalInputDto,
} from './terminal-input.dto';

describe('TerminalInputDto', () => {
  it('accepts an input frame at the configured limit', async () => {
    const dto = new TerminalInputDto();
    dto.data = 'x'.repeat(TERMINAL_INPUT_MAX_CHARS);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an input frame over the configured limit', async () => {
    const dto = new TerminalInputDto();
    dto.data = 'x'.repeat(TERMINAL_INPUT_MAX_CHARS + 1);

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('maxLength');
  });
});
