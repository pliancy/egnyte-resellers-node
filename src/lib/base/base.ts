import { EgnyteConfig } from '../types'
import axios, { AxiosInstance } from 'axios'
import { CookieJar } from 'tough-cookie'
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http'
import { loginResellerPortal } from './portal-login'

export class Base {
    readonly http!: AxiosInstance

    resellerId!: string

    private _extractTrailingNumericIdFromLocation(location: string): string | null {
        // Location may be relative ("/msp/plan/12891/") or absolute ("https://.../msp/plan/12891/").
        // We want the trailing numeric segment.
        const path = (() => {
            try {
                return new URL(location, 'https://resellers.egnyte.com').pathname
            } catch {
                return location
            }
        })()

        const match = path.match(/\/(\d+)\/?$/)
        return match?.[1] ?? null
    }

    constructor(readonly config: EgnyteConfig) {
        if (!config.username || !config.password) {
            throw new Error('missing config values username or password')
        }

        // If timeoutMs is provided ensure it's a number or default to 20000
        const ms = this.config.timeoutMs ?? -1
        const n = parseInt(ms as any)
        const timeout = !isNaN(n) && Math.abs(n) > 1 ? n : 20000
        const jar = new CookieJar()
        this.http = axios.create({
            baseURL: 'https://resellers.egnyte.com',
            timeout,
            httpAgent: new HttpCookieAgent({ cookies: { jar } }),
            httpsAgent: new HttpsCookieAgent({ cookies: { jar } }),
        })
    }

    /**
     * authenticate to egnyte api. gets auth cookie
     * @returns the auth cookie string
     */
    async authenticate(): Promise<{ authCookie: string; csrfToken: string }> {
        const { authCookie, csrfToken } = await loginResellerPortal({
            username: this.config.username,
            password: this.config.password,
            headless: this.config.portalHeadless,
            loginTimeoutMs: this.config.portalLoginTimeoutMs,
        })
        await this.setResellerId(authCookie)
        return { authCookie, csrfToken }
    }

    /**
     * Gets the resellerId for the logged in reseller by parsing out of the 302 from server
     * @param authCookie authCookie from _authenticate() call
     * @returns resellerId in string form
     */
    async setResellerId(authCookie: string): Promise<string> {
        if (!authCookie) throw new Error('missing authCookie')
        const res = await this.http.get('/customer/browse/', {
            headers: { cookie: authCookie },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status <= 303,
        })
        if (res.status === 302) {
            const location = res.headers.location
            if (!location) throw new Error('unable to find location header in response')
            const resellerId = this._extractTrailingNumericIdFromLocation(location)
            if (!resellerId) {
                throw new Error(
                    `unable to parse resellerId from location header: ${JSON.stringify(location)}`,
                )
            }
            this.resellerId = resellerId
            return resellerId
        } else {
            throw new Error('an error occurred attempting to get the resellerId')
        }
    }
}
