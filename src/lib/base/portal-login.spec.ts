import {
    assertResellersOrigin,
    findPortalSessionCookie,
    parseCsrfFromLoginHtml,
    isSpaSignInUrl,
    mergeLoginCsrfFields,
    parseLoginErrorFromBody,
    parseLoginErrorFromHtml,
    parseRecaptchaSiteKeyFromLoginHtml,
} from './portal-login'

describe('parseCsrfFromLoginHtml', () => {
    it('parses csrfmiddlewaretoken hidden input', () => {
        const html = `<input name="csrfmiddlewaretoken" value="abc123" type="hidden">`
        expect(parseCsrfFromLoginHtml(html)).toEqual({ csrfMiddlewareToken: 'abc123' })
    })

    it('parses csrf-token meta tag', () => {
        const html = `<meta name="csrf-token" content="meta-token">`
        expect(parseCsrfFromLoginHtml(html)).toEqual({ csrfMiddlewareToken: 'meta-token' })
    })
})

describe('isSpaSignInUrl', () => {
    it('detects the React sign-in route', () => {
        expect(isSpaSignInUrl('https://resellers.egnyte.com/auth/sign-in')).toBe(true)
    })

    it('does not treat legacy django login as SPA', () => {
        expect(isSpaSignInUrl('https://resellers.egnyte.com/accounts/login/')).toBe(false)
    })
})

describe('parseLoginErrorFromBody', () => {
    it('parses JSON API errors', () => {
        expect(
            parseLoginErrorFromBody('{"code":"not_authenticated","message":"Invalid username or password."}'),
        ).toBe('Invalid username or password.')
    })
})

describe('mergeLoginCsrfFields', () => {
    it('uses csrftoken cookie when middleware hidden field is absent', () => {
        expect(mergeLoginCsrfFields({ csrfToken: 'cookie-only' })).toEqual({
            csrfMiddlewareToken: 'cookie-only',
            csrfToken: 'cookie-only',
        })
    })

    it('requires csrftoken cookie', () => {
        expect(mergeLoginCsrfFields({ csrfMiddlewareToken: 'field-only' })).toBeUndefined()
    })
})

describe('parseLoginErrorFromHtml', () => {
    it('parses Django errorlist message', () => {
        const html =
            '<ul class="errorlist nonfield"><li>(Hidden field recaptcha) Error verifying reCAPTCHA, please try again.</li></ul>'
        expect(parseLoginErrorFromHtml(html)).toBe(
            '(Hidden field recaptcha) Error verifying reCAPTCHA, please try again.',
        )
    })
})

describe('parseRecaptchaSiteKeyFromLoginHtml', () => {
    it('parses data-sitekey on recaptcha input', () => {
        const html =
            '<input class="g-recaptcha" data-sitekey="6LeTestKey" name="recaptcha" id="id_recaptcha">'
        expect(parseRecaptchaSiteKeyFromLoginHtml(html)).toBe('6LeTestKey')
    })

    it('parses site key from recaptcha api.js render query', () => {
        const html =
            '<script src="https://www.google.com/recaptcha/api.js?render=6LeRenderKey"></script>'
        expect(parseRecaptchaSiteKeyFromLoginHtml(html)).toBe('6LeRenderKey')
    })
})

describe('assertResellersOrigin', () => {
    it('allows resellers.egnyte.com', () => {
        expect(() => assertResellersOrigin('https://resellers.egnyte.com/accounts/login/')).not.toThrow()
    })

    it('allows about:blank', () => {
        expect(() => assertResellersOrigin('about:blank')).not.toThrow()
    })

    it('rejects other origins', () => {
        expect(() => assertResellersOrigin('https://evil.example/phish')).toThrow(/unexpected origin/)
    })
})

describe('findPortalSessionCookie', () => {
    it('prefers pbapp3sess over anonymous sessionid on the login page', () => {
        const cookies = [
            { name: 'sessionid', value: 'anonymous' },
            { name: 'pbapp3sess', value: 'authenticated' },
            { name: 'csrftoken', value: 'csrf' },
        ]
        expect(findPortalSessionCookie(cookies, true)).toEqual({
            name: 'pbapp3sess',
            value: 'authenticated',
        })
    })

    it('ignores sessionid on the login page when pbapp3sess is absent', () => {
        const cookies = [
            { name: 'sessionid', value: 'anonymous' },
            { name: 'csrftoken', value: 'csrf' },
        ]
        expect(findPortalSessionCookie(cookies, true)).toBeUndefined()
    })

    it('uses sessionid after leaving the login page', () => {
        const cookies = [
            { name: 'sessionid', value: 'authenticated' },
            { name: 'csrftoken', value: 'csrf' },
        ]
        expect(findPortalSessionCookie(cookies, false)).toEqual({
            name: 'sessionid',
            value: 'authenticated',
        })
    })
})
