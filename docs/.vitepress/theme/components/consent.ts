// Google Analytics behind an explicit opt-in: gtag.js is fetched only after the visitor
// accepts, so nothing reaches Google and no _ga cookie is set before consent.
import { ref } from 'vue'

const GA_ID = 'G-BC7D2DYJ8P'
const KEY = 'bb-analytics-consent'

/** Whether the consent banner is shown. */
export const consentOpen = ref(false)

/** Reopens the banner so a visitor can change an earlier choice. */
export function openConsent() {
  consentOpen.value = true
}

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
let loaded = false

function load() {
  if (loaded) return
  loaded = true
  const w = window as GtagWindow
  w.dataLayer = w.dataLayer || []
  // gtag.js reads Arguments objects from the dataLayer, not arrays.
  w.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments)
  }
  w.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' })
  w.gtag('consent', 'update', { analytics_storage: 'granted' })
  w.gtag('js', new Date())
  w.gtag('config', GA_ID)
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.append(script)
}

function stored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Client start: restores a stored choice, or asks. */
export function initConsent() {
  const choice = stored()
  if (choice === 'granted') load()
  else if (choice !== 'denied') consentOpen.value = true
}

export function setConsent(granted: boolean) {
  try {
    localStorage.setItem(KEY, granted ? 'granted' : 'denied')
  } catch {
    // No storage: the choice holds for this page view only.
  }
  consentOpen.value = false
  if (granted) return load()
  if (!loaded) return
  // Withdrawn after granting: stop storage and drop the cookies GA set on this host or a parent domain.
  ;(window as GtagWindow).gtag?.('consent', 'update', { analytics_storage: 'denied' })
  const parts = location.hostname.split('.')
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n.startsWith('_ga'))) {
    for (let i = 0; i < parts.length; i++) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${parts.slice(i).join('.')}`
    }
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}
