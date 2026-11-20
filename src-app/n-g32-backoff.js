// g32 clean-room: exponential retry backoff with optional jitter for the sync socket.
export function ng32DefineBackoff() {
  function Ng32Backoff(min, max, base, jitter) {
    this.min = min || 0;
    this.max = max === undefined ? Number.MAX_VALUE : max;
    this.base = base || 1000;
    this.jitter = jitter === undefined ? true : jitter;
    this.count = 0;
    this.nextTs = Date.now();
  }

  Ng32Backoff.prototype.getTimeout = function () {
    if (this.count === 0) return this.min;
    let timeout = this.base * Math.pow(2, this.count - 1);
    if (this.jitter) timeout *= 0.5 + 0.5 * Math.random();
    return Math.floor(Math.min(this.max, this.min + timeout));
  };

  Ng32Backoff.prototype.success = function () {
    this.count = 0;
    this.nextTs = Date.now() + this.getTimeout();
  };

  Ng32Backoff.prototype.fail = function () {
    this.count++;
    this.nextTs = Date.now() + this.getTimeout();
  };

  Ng32Backoff.prototype.getNextTs = function () { return this.nextTs; };
  Ng32Backoff.prototype.isReady = function () { return Date.now() > this.nextTs; };

  return Ng32Backoff;
}
