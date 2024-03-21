import { Plans } from './plans'

describe('Plans', () => {
    let plans: Plans
    const config = { username: 'username', password: 'password' }

    beforeEach(() => {
        plans = new Plans(config)
    })

    it('gets all protect plans', async () => {
        const data = [
            {
                protectawesomecustomer: {
                    storage_stats: { Used: 100, Unused: 200, Available: 100 },
                },
            },
        ]
        jest.spyOn(plans, 'authenticate' as never).mockResolvedValue({
            authCookie: 'authCookie',
            csrfToken: 'csrfToken',
        } as never)
        jest.spyOn(plans.http, 'get').mockResolvedValue({ data } as never)
        await expect(plans.getAllProtectPlans()).resolves.toEqual(data)
    })
})
