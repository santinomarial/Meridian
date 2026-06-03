import { WsRateLimiter } from './ws-rate-limiter.service';

describe('WsRateLimiter', () => {
  let limiter: WsRateLimiter;

  beforeEach(() => {
    limiter = new WsRateLimiter();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('check — within limit', () => {
    it('allows the first message', () => {
      expect(limiter.check('sock-1', 5)).toBe(true);
    });

    it('allows messages up to the per-second limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('sock-1', 5)).toBe(true);
      }
    });

    it('allows messages from different sockets independently', () => {
      for (let i = 0; i < 5; i++) limiter.check('sock-1', 5);

      // sock-2 has its own fresh window — must not be blocked by sock-1
      expect(limiter.check('sock-2', 5)).toBe(true);
    });
  });

  describe('check — limit exceeded', () => {
    it('returns false when the per-second limit is exceeded', () => {
      for (let i = 0; i < 5; i++) limiter.check('sock-1', 5);

      expect(limiter.check('sock-1', 5)).toBe(false);
    });

    it('continues to return false for subsequent messages in the same window', () => {
      for (let i = 0; i < 5; i++) limiter.check('sock-1', 5);

      expect(limiter.check('sock-1', 5)).toBe(false);
      expect(limiter.check('sock-1', 5)).toBe(false);
    });
  });

  describe('window reset', () => {
    it('resets the window after 1 second and allows messages again', () => {
      for (let i = 0; i < 5; i++) limiter.check('sock-1', 5);
      expect(limiter.check('sock-1', 5)).toBe(false);

      jest.advanceTimersByTime(1_000);

      expect(limiter.check('sock-1', 5)).toBe(true);
    });

    it('does not reset before 1 second has elapsed', () => {
      for (let i = 0; i < 5; i++) limiter.check('sock-1', 5);

      jest.advanceTimersByTime(999);

      expect(limiter.check('sock-1', 5)).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes the socket entry so subsequent checks start fresh', () => {
      for (let i = 0; i < 5; i++) limiter.check('sock-1', 5);
      expect(limiter.check('sock-1', 5)).toBe(false);

      limiter.clear('sock-1');

      expect(limiter.check('sock-1', 5)).toBe(true);
    });

    it('decrements the size after clearing', () => {
      limiter.check('sock-1', 5);
      limiter.check('sock-2', 5);
      expect(limiter.size()).toBe(2);

      limiter.clear('sock-1');

      expect(limiter.size()).toBe(1);
    });

    it('is a no-op for an unknown socket', () => {
      expect(() => limiter.clear('ghost')).not.toThrow();
    });
  });
});
