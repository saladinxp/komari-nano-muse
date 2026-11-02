/// <reference types="vite/client" />

declare global {
  interface Window {
    /** Debug handle on the live state. */
    NM: unknown
    /** Set by the offline preview: route with location.hash instead of history. */
    __NM_HASH_ROUTER__?: boolean
    /** Set by the offline preview: hooks for the scenario switcher. */
    __NM_APP__?: Record<string, (...args: any[]) => unknown>
    previewSocket?: any
    previewScenario?: (value: string) => Promise<void>
    previewRequests?: unknown[]
  }
}

export {}
