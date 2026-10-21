import { Base } from './base'
import { EgnyteConfig } from '../types'
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http'
import * as portalLogin from './portal-login'
import Mock = jest.Mock

jest.mock('./portal-login')

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
        const authCookie = 'sessionid=abc'
        const csrfToken = 'csrfToken'

        beforeEach(() => {
            base = new Base(config)
            jest.spyOn(portalLogin, 'loginResellerPortal').mockResolvedValue({
                authCookie,
                csrfToken,
            })
        })

        it('sets the resellerId and returns the authCookie and csrfToken', async () => {
            jest.spyOn(base, 'setResellerId').mockImplementation(async () => {
                base.resellerId = 'resellerId'
                return 'resellerId'
            })

            const res = await base.authenticate()

            expect(portalLogin.loginResellerPortal).toHaveBeenCalledWith({
                username: config.username,
                password: config.password,
                headless: undefined,
                loginTimeoutMs: undefined,
            })
            expect(res).toEqual({ authCookie, csrfToken })
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
})
