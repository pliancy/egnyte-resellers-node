import Egnyte from './'

describe('Egnyte', () => {
    let egnyte: Egnyte

    beforeEach(() => {
        egnyte = new Egnyte({
            username: 'a',
            password: 'b',
        })
    })

    describe('http config', () => {
        it('defaults to a 20000ms timeout given timeoutMs is undefined', async () => {
            const ern = new Egnyte({
                username: 'user',
                password: 'pass',
            })

            expect(ern['httpConfig'].timeout).toBe(20000)
        })

        it('defaults to a 20000ms timeout given timeoutMs is not parsable as an integer', async () => {
            const ern = new Egnyte({
                username: 'user',
                password: 'pass',
                timeoutMs: 'NotANumber' as any,
            })

            expect(ern['httpConfig'].timeout).toBe(20000)
        })

        it('sets timeout given timeoutMs is parsable as an integer', async () => {
            const ern = new Egnyte({
                username: 'user',
                password: 'pass',
                timeoutMs: '30000,' as any,
            })

            expect(ern['httpConfig'].timeout).toBe(30000)
        })
    })

    describe('helpers', () => {
        it('gets CSRF tokens', async () => {
            const csrfMiddlewareToken = 'fec9a59a86510210de334ca4e251ed3d'
            const csrfToken = '12345'
            const data = `<input type='hidden' id='csrfmiddlewaretoken' name='csrfmiddlewaretoken' value=${csrfMiddlewareToken} />`
            jest.spyOn(egnyte, '_egnyteRequest' as never).mockImplementation(
                () =>
                    ({
                        data,
                        headers: { 'set-cookie': [`csrftoken=${csrfToken}; expires=Some Date;`] },
                    } as never),
            )
            let result = await egnyte['_getCsrfTokens']()
            return expect(result).toEqual({
                csrfMiddlewareToken,
                csrfToken,
            })
        })
    })
})
