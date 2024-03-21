import { EgnyteConfig } from '../types'
import axios, { AxiosInstance } from 'axios'
import { escape } from 'node:querystring'
import { load } from 'cheerio'
import { CookieJar } from 'tough-cookie'
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http'

export class Base {
    readonly http!: AxiosInstance

    resellerId!: string

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
    async authenticate(): Promise<any> {
        const { csrfMiddlewareToken, csrfToken } = await this._getCsrfTokens()
        const auth = await this.http.post(
            '/accounts/login/',
            `csrfmiddlewaretoken=${csrfMiddlewareToken}&username=${escape(
                this.config.username,
            )}&password=${escape(this.config.password)}&this_is_the_login_form=1`,
            {
                params: {
                    csrfmiddlewaretoken: csrfMiddlewareToken,
                    username: escape(this.config.username),
                    password: escape(this.config.password),
                    this_is_the_login_form: 1,
                },
                maxRedirects: 0,
                headers: {
                    Referer: 'https://resellers.egnyte.com/accounts/login/',
                    Cookie: `csrftoken=${csrfToken}`,
                },
                validateStatus: (status) => status >= 200 && status <= 303,
            },
        )
        if (auth.status === 302) {
            const setCookieHeader = auth.headers['set-cookie']
            if (!setCookieHeader) throw new Error('unable to find set-cookie header in response')
            const authCookie = (setCookieHeader[0] ?? '').split(';')[0]
            await this.setResellerId(authCookie as string)
            return { authCookie, csrfToken }
        } else {
            throw new Error('Authentication failed. Bad username or password.')
        }
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
            const resellerId = location.split('/')[5]
            this.resellerId = resellerId
            return resellerId
        } else {
            throw new Error('an error occurred attempting to get the resellerId')
        }
    }

    /**
     * Gets a csrf token and returns it
     * @returns the csrf token
     */
    private async _getCsrfTokens() {
        const res = await this.http.get('accounts/login/')
        // Use Cheerio to parse webpage for csrfmiddlewaretoken
        const html = load(res.data)
        const csrfMiddlewareToken = html('[name=csrfmiddlewaretoken]').val()

        // Regex cookies to get csrfToken
        const cookies = (res?.headers as any)['set-cookie'] ?? []
        const csrfToken = cookies
            .find((e: string) => e.includes('csrftoken'))
            .match(/csrftoken=(.*); expires/)[1]
        if (!csrfMiddlewareToken || !csrfToken)
            throw new Error('unable to find CSRF token in egnyte resellers login page')
        return { csrfMiddlewareToken, csrfToken }
    }
}
