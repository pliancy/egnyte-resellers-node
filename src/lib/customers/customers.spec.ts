import { Customers } from './customers'
import { Plans } from '../plans/plans'

describe('Customers', () => {
    let customers: Customers
    let plans: Plans

    const config = { username: 'username', password: 'password' }

    beforeEach(() => {
        plans = new Plans(config)
        customers = new Customers(plans, config)
    })

    it('returns null given customer does not have customers protect', async () => {
        jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
            authCookie: 'authCookie',
            csrfToken: 'csrfToken',
        } as never)
        jest.spyOn(customers.http, 'get' as never).mockResolvedValue({
            data: [
                {
                    protectawesomecustomer: {
                        storage_stats: {},
                    },
                },
            ],
        } as never)
        await expect(customers.getCustomerProtectPlanUsage('SOMEOTHERCUSTOMER')).resolves.toBeNull()
    })

    it('gets protect plan usage', async () => {
        const storage_stats = { Used: 100, Unused: 200, Available: 100 }
        jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
            authCookie: 'authCookie',
            csrfToken: 'csrfToken',
        } as never)
        jest.spyOn(customers.http, 'get' as never).mockResolvedValue({
            data: [
                {
                    protectawesomecustomer: {
                        storage_stats,
                    },
                },
            ],
        } as never)
        await expect(customers.getCustomerProtectPlanUsage('AWESOMECUSTOMER')).resolves.toEqual(
            storage_stats,
        )
    })
})
