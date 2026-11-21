// g27 env: single lazy access point to application-scope (bundle) values.
// bindEnv installs one thunk exactly once at bundle init; env() invokes the
// thunk on EVERY call and returns its result — never cached, so late-bound
// bundle variables stay correct. Before binding, env() yields {}.

let ng27EnvThunk = () => ({});

export function bindEnv(t) {
  ng27EnvThunk = t;
}

export function env() {
  return ng27EnvThunk();
}

export const hostEnv = env;
