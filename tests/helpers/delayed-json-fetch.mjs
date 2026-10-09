// Finite delayed upstream response: an absent deadline fails instead of hanging tests.
export function delayedJsonFetch(payload, delayMs = 150) {
  return async (_url, { signal } = {}) => new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve(new Response(JSON.stringify(payload), { status: 200 }))
    }
    const timer = setTimeout(finish, delayMs)
    function abort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}
