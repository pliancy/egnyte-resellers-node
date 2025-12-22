import { Base } from './base'
import { EgnyteConfig } from '../types'
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http'
import { escape } from 'node:querystring'
import Mock = jest.Mock

describe('Base', () => {
    let base: Base
    let config: EgnyteConfig

    beforeEach(() => {
        jest.restoreAllMocks()
        config = {
            username: 'username',
            password: 'password',
        }
    })

    it('fails given bad config', () => {
        try {
            const base = new Base({} as never)
            expect(base).toBeInstanceOf(Base)
        } catch (e) {
            expect(e).toEqual(new Error('missing config values username or password'))
        }
    })

    describe('constructor', () => {
        beforeEach(() => {
            base = new Base(config)
        })

        it('creates an AxiosInstance', () => {
            const axiosInstance = base.http
            expect(axiosInstance.defaults.baseURL).toEqual('https://resellers.egnyte.com')
            expect(axiosInstance.defaults.httpAgent).toBeInstanceOf(HttpCookieAgent)
            expect(axiosInstance.defaults.httpsAgent).toBeInstanceOf(HttpsCookieAgent)
        })

        it('defaults to a 20000ms timeout given timeoutMs is undefined', async () => {
            const ern = new Base({
                username: 'user',
                password: 'pass',
            })

            expect(ern.http.defaults.timeout).toBe(20000)
        })

        it('defaults to a 20000ms timeout given timeoutMs is not parsable as an integer', async () => {
            const ern = new Base({
                username: 'user',
                password: 'pass',
                timeoutMs: 'NotANumber' as any,
            })

            expect(ern.http.defaults.timeout).toBe(20000)
        })

        it('sets timeout given timeoutMs is parsable as an integer', async () => {
            const ern = new Base({
                username: 'user',
                password: 'pass',
                timeoutMs: '30000,' as any,
            })

            expect(ern.http.defaults.timeout).toBe(30000)
        })
    })

    describe('authenticate', () => {
        const tokens = {
            csrfMiddlewareToken: 'csrfMiddlewareToken',
            csrfToken: 'csrfToken',
        }

        const authCookie = 'authCookie'

        beforeEach(() => {
            base = new Base(config)
            jest.spyOn(base, '_getCsrfTokens' as never).mockResolvedValue(tokens as never)
        })

        it('fails given a non-302 status', async () => {
            jest.spyOn(base.http, 'post').mockResolvedValue({ status: 200 })

            try {
                await base.authenticate()
            } catch (e) {
                expect(e).toEqual(new Error('Authentication failed. Bad username or password.'))
            }
        })

        it('fails given missing set-cookie header', async () => {
            jest.spyOn(base.http, 'post').mockResolvedValue({
                status: 302,
                headers: {},
            })

            await expect(base.authenticate()).rejects.toEqual(
                new Error('unable to find set-cookie header in response'),
            )
        })

        it('sets the resellerId and returns the authCookie and csrfToken', async () => {
            jest.spyOn(base.http, 'post').mockResolvedValue({
                status: 302,
                headers: { 'set-cookie': [`${authCookie};`] },
            })
            jest.spyOn(base, 'setResellerId').mockImplementation(async () => {
                base.resellerId = 'resellerId'
                return 'resellerId'
            })

            const res = await base.authenticate()

            expect(res).toEqual({ authCookie, csrfToken: tokens.csrfToken })
            const [path, data, conf] = (base.http.post as Mock).mock.calls[0]
            expect(data).toEqual(
                `csrfmiddlewaretoken=${tokens.csrfMiddlewareToken}&username=${escape(
                    config.username,
                )}&password=${escape(config.password)}&this_is_the_login_form=1`,
            )
            expect(path).toEqual('/accounts/login/')
            expect(conf.headers).toEqual({
                Cookie: 'csrftoken=csrfToken',
                Referer: 'https://resellers.egnyte.com/accounts/login/',
            })
            expect(conf.maxRedirects).toBe(0)
            expect(base.setResellerId).toHaveBeenCalledWith(authCookie)
        })
    })

    describe('setResellerId', () => {
        beforeEach(() => {
            base = new Base(config)
        })

        it('fails given missing authCookie', async () => {
            await expect(base.setResellerId('' as any)).rejects.toEqual(
                new Error('missing authCookie'),
            )
        })

        it('fails given a non-302 status', async () => {
            jest.spyOn(base.http, 'get').mockResolvedValue({ status: 200 })
            await expect(base.setResellerId('authCookie')).rejects.toEqual(
                new Error('an error occurred attempting to get the resellerId'),
            )
        })

        it('fails given missing location header', async () => {
            jest.spyOn(base.http, 'get').mockResolvedValue({
                status: 302,
                headers: {},
            })

            await expect(base.setResellerId('authCookie')).rejects.toEqual(
                new Error('unable to find location header in response'),
            )
        })

        it('parses resellerId from a relative location header', async () => {
            jest.spyOn(base.http, 'get').mockResolvedValue({
                status: 302,
                headers: { location: '/msp/plan/12891/' },
            })

            await expect(base.setResellerId('authCookie')).resolves.toBe('12891')
            expect(base.resellerId).toBe('12891')

            const [path, conf] = (base.http.get as Mock).mock.calls[0]
            expect(path).toBe('/customer/browse/')
            expect(conf.headers).toEqual({ cookie: 'authCookie' })
            expect(conf.maxRedirects).toBe(0)
            expect(conf.validateStatus).toBeInstanceOf(Function)
        })

        it('parses resellerId from an absolute location header', async () => {
            jest.spyOn(base.http, 'get').mockResolvedValue({
                status: 302,
                headers: { location: 'https://resellers.egnyte.com/msp/plan/12891/' },
            })

            await expect(base.setResellerId('authCookie')).resolves.toBe('12891')
            expect(base.resellerId).toBe('12891')
        })

        it('fails given a location header that does not end in a numeric id', async () => {
            jest.spyOn(base.http, 'get').mockResolvedValue({
                status: 302,
                headers: { location: '/msp/plan/not-a-number/' },
            })

            await expect(base.setResellerId('authCookie')).rejects.toEqual(
                new Error(
                    'unable to parse resellerId from location header: "/msp/plan/not-a-number/"',
                ),
            )
        })
    })

    describe('_getCsrfTokens', () => {
        beforeEach(() => {
            base = new Base(config)
        })

        it('gets CSRF tokens', async () => {
            const csrfMiddlewareToken = 'fec9a59a86510210de334ca4e251ed3d'
            const csrfToken = '12345'
            const data = `<input type='hidden' id='csrfmiddlewaretoken' name='csrfmiddlewaretoken' value=${csrfMiddlewareToken} />`
            jest.spyOn(base.http, 'get').mockResolvedValue({
                data,
                headers: { 'set-cookie': [`csrftoken=${csrfToken}; expires=Some Date;`] },
            })
            let result = await base['_getCsrfTokens']()
            return expect(result).toEqual({
                csrfMiddlewareToken,
                csrfToken,
            })
        })
    })
})
