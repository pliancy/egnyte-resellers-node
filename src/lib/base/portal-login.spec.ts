import { findPortalSessionCookie } from './portal-login'

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
