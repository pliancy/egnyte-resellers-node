import { Customers } from './customers'
import { Plans } from '../plans/plans'

describe('Customers', () => {
    let customers: Customers
    let plans: Plans

    const config = { username: 'username', password: 'password', resellerId: '123' }

    beforeEach(() => {
        plans = new Plans(config)
        customers = new Customers(plans, config)
        customers.resellerId = '123'
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    describe('getAllCustomers', () => {
        it('retrieves all customers across multiple plans', async () => {
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
                authCookie: 'authCookie',
                csrfToken: 'csrfToken',
            } as never)
            jest.spyOn(plans, '_getAllPlanIds').mockResolvedValue(['plan1', 'plan2'])

            const plan1Data = [
                {
                    customer1: {
                        power_user_stats: { Used: 5, Unused: 5, Available: 10 },
                        storage_stats: { Used: 100, Unused: 100, Available: 200 },
                        feature_stats: { additional_su: 20, total_power_users: 10 },
                    },
                },
            ]
            const plan2Data = [
                {
                    customer2: {
                        power_user_stats: { Used: 2, Unused: 8, Available: 5 },
                        storage_stats: { Used: 50, Unused: 150, Available: 100 },
                        feature_stats: { additional_su: 15, total_power_users: 5 },
                    },
                },
            ]

            const getSpy = jest
                .spyOn(customers.http, 'get')
                .mockResolvedValueOnce({ data: plan1Data } as any)
                .mockResolvedValueOnce({ data: plan2Data } as any)

            const promise = customers.getAllCustomers()

            // Handle delays for backoff
            await jest.runAllTimersAsync()

            const result = await promise

            expect(result).toHaveLength(2)
            expect(result[0]!.customerEgnyteId).toBe('customer1')
            expect(result[0]!.powerUsers).toEqual({ total: 10, used: 5, available: 10, free: 5 })
            expect(result[1]!.customerEgnyteId).toBe('customer2')
            expect(getSpy).toHaveBeenCalledTimes(2)
        })

        it('skips plans that fail to load', async () => {
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
                authCookie: 'authCookie',
                csrfToken: 'csrfToken',
            } as never)
            jest.spyOn(plans, '_getAllPlanIds').mockResolvedValue(['plan1', 'plan2'])

            jest.spyOn(customers.http, 'get')
                .mockRejectedValueOnce(new Error('API Error'))
                .mockResolvedValueOnce({
                    data: [
                        {
                            customer2: {
                                power_user_stats: { Used: 2, Unused: 8, Available: 5 },
                                storage_stats: { Used: 50, Unused: 150, Available: 100 },
                                feature_stats: { additional_su: 15, total_power_users: 5 },
                            },
                        },
                    ],
                } as any)

            const promise = customers.getAllCustomers()
            await jest.runAllTimersAsync()
            const result = await promise

            expect(result).toHaveLength(1)
            expect(result[0]!.customerEgnyteId).toBe('customer2')
        })

        it('handles empty object response by returning an empty list for that plan', async () => {
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
                authCookie: 'authCookie',
                csrfToken: 'csrfToken',
            } as never)
            jest.spyOn(plans, '_getAllPlanIds').mockResolvedValue(['plan1'])

            // Mock API returning {} instead of []
            const getSpy = jest.spyOn(customers.http, 'get').mockResolvedValueOnce({ data: {} } as any)

            const promise = customers.getAllCustomers()
            await jest.runAllTimersAsync()
            const result = await promise

            expect(result).toHaveLength(0)
            expect(getSpy).toHaveBeenCalledTimes(1)
        })

        it('handles empty array response by returning an empty list for that plan', async () => {
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
                authCookie: 'authCookie',
                csrfToken: 'csrfToken',
            } as never)
            jest.spyOn(plans, '_getAllPlanIds').mockResolvedValue(['plan1'])

            // Mock API returning []
            const getSpy = jest.spyOn(customers.http, 'get').mockResolvedValueOnce({ data: [] } as any)

            const promise = customers.getAllCustomers()
            await jest.runAllTimersAsync()
            const result = await promise

            expect(result).toHaveLength(0)
            expect(getSpy).toHaveBeenCalledTimes(1)
        })
    })

    describe('getOneCustomer', () => {
        it('returns a single customer by ID', async () => {
            const mockCustomers = [
                { customerEgnyteId: 'cust1' },
                { customerEgnyteId: 'cust2' },
            ] as any[]
            jest.spyOn(customers, 'getAllCustomers').mockResolvedValue(mockCustomers)

            const result = await customers.getOneCustomer('cust2')
            expect(result.customerEgnyteId).toBe('cust2')
        })

        it('throws an error if customer is not found', async () => {
            jest.spyOn(customers, 'getAllCustomers').mockResolvedValue([])
            await expect(customers.getOneCustomer('nonexistent')).rejects.toThrow(
                'unable to find egnyte customer: nonexistent',
            )
        })
    })

    describe('updateCustomer', () => {
        it('updates power users and storage when provided', async () => {
            const customer = {
                customerEgnyteId: 'cust1',
                powerUsers: { total: 10, used: 5 },
                storageGB: { total: 100, used: 50 },
            } as any
            jest.spyOn(customers, 'getAllCustomers').mockResolvedValue([customer])
            const updatePowerUsersSpy = jest
                .spyOn(customers, 'updateCustomerPowerUsers')
                .mockResolvedValue({ result: 'SUCCESS', message: 'ok' })
            const updateStorageSpy = jest
                .spyOn(customers, 'updateCustomerStorage')
                .mockResolvedValue({ result: 'SUCCESS', message: 'ok' })

            const result = await customers.updateCustomer('cust1', {
                powerUsers: { total: 20 },
                storageGB: { total: 200 },
            } as any)

            expect(updatePowerUsersSpy).toHaveBeenCalledWith('cust1', 20)
            expect(updateStorageSpy).toHaveBeenCalledWith('cust1', 200)
            expect(result.powerUsers.total).toBe(20)
            expect(result.storageGB.total).toBe(200)
        })

        it('does not update if values are the same', async () => {
            const customer = {
                customerEgnyteId: 'cust1',
                powerUsers: { total: 10, used: 5 },
                storageGB: { total: 100, used: 50 },
            } as any
            jest.spyOn(customers, 'getAllCustomers').mockResolvedValue([customer])
            const updatePowerUsersSpy = jest.spyOn(customers, 'updateCustomerPowerUsers')
            const updateStorageSpy = jest.spyOn(customers, 'updateCustomerStorage')

            await customers.updateCustomer('cust1', {
                powerUsers: { total: 10 },
                storageGB: { total: 100 },
            } as any)

            expect(updatePowerUsersSpy).not.toHaveBeenCalled()
            expect(updateStorageSpy).not.toHaveBeenCalled()
        })
    })

    describe('updateCustomerStorage', () => {
        it('successfully updates storage', async () => {
            const customer = {
                customerEgnyteId: 'cust1',
                storageGB: { total: 100, used: 50 },
            } as any
            jest.spyOn(customers, 'getOneCustomer').mockResolvedValue(customer)
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
                authCookie: 'authCookie',
                csrfToken: 'csrfToken',
            } as never)
            jest.spyOn(customers.http, 'post').mockResolvedValue({
                data: { msg: 'Plan updated successfully!' },
            } as any)

            const result = await customers.updateCustomerStorage('cust1', 150)

            expect(result.result).toBe('SUCCESS')
            expect(customers.http.post).toHaveBeenCalledWith(
                expect.stringContaining('/msp/change_storage/'),
                expect.objectContaining({ storage: '150' }),
                expect.anything(),
            )
        })

        it('refuses to set storage below current usage', async () => {
            const customer = {
                customerEgnyteId: 'cust1',
                storageGB: { total: 100, used: 80 },
            } as any
            jest.spyOn(customers, 'getOneCustomer').mockResolvedValue(customer)

            const result = await customers.updateCustomerStorage('cust1', 50)

            expect(result.result).toBe('NO_CHANGE')
            expect(result.message).toContain('currently has 80GB storage in use')
        })

        it('returns NO_CHANGE if storage is already at the target', async () => {
            const customer = {
                customerEgnyteId: 'cust1',
                storageGB: { total: 100, used: 50 },
            } as any
            jest.spyOn(customers, 'getOneCustomer').mockResolvedValue(customer)

            const result = await customers.updateCustomerStorage('cust1', 100)

            expect(result.result).toBe('NO_CHANGE')
        })

        it('throws error on API failure', async () => {
            jest.spyOn(customers, 'getOneCustomer').mockResolvedValue({
                storageGB: { total: 100, used: 50 },
            } as any)
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({} as never)
            jest.spyOn(customers.http, 'post').mockResolvedValue({
                data: { msg: 'Failed!' },
            } as any)

            await expect(customers.updateCustomerStorage('cust1', 150)).rejects.toThrow('Failed!')
        })
    })

    describe('updateCustomerPowerUsers', () => {
        beforeEach(() => {
            const customer = {
                customerEgnyteId: 'cust1',
                planId: 'plan1',
                powerUsers: { total: 10, used: 5, available: 5 },
            } as any
            jest.spyOn(customers, 'getOneCustomer').mockResolvedValue(customer)
            jest.spyOn(customers, 'authenticate' as never).mockResolvedValue({
                authCookie: 'authCookie',
                csrfToken: 'csrfToken',
            } as never)
        })

        it('successfully updates power users', async () => {
            jest.spyOn(customers.http, 'post').mockResolvedValue({
                data: { msg: 'Plan updated successfully!' },
            } as any)

            const result = await customers.updateCustomerPowerUsers('cust1', 15)

            expect(result.result).toBe('SUCCESS')
            expect(customers.http.post).toHaveBeenCalledWith(
                expect.stringContaining('/msp/change_power_users/'),
                expect.objectContaining({ power_users: '15' }),
                expect.anything(),
            )
        })

        it('throws error if not enough licenses and autoAddToPool is false', async () => {
            await expect(customers.updateCustomerPowerUsers('cust1', 20)).rejects.toThrow(
                'Not enough available licenses',
            )
        })

        it('auto-adds licenses to pool if requested', async () => {
            jest.spyOn(customers.http, 'post').mockResolvedValue({
                data: { msg: 'Plan updated successfully!' },
            } as any)
            const ensureSpy = jest
                .spyOn(customers as any, 'ensureSufficientLicensesInPool')
                .mockResolvedValue(undefined)

            await customers.updateCustomerPowerUsers('cust1', 20, true)

            expect(ensureSpy).toHaveBeenCalledWith('plan1', 10, 5)
        })

        it('uses force license change if configured', async () => {
            ;(customers as any).config.forceLicenseChange = true
            jest.spyOn(customers.http, 'post').mockResolvedValue({
                status: 400,
                data: { msg: 'CFS plan upgrade failed. Please contact support.' },
            } as any)

            const result = await customers.updateCustomerPowerUsers('cust1', 2)
            expect(result.result).toBe('SUCCESS')
            expect(result.message).toContain('with force option')
        })
    })

    describe('getCustomerProtectPlanUsage', () => {
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
            await expect(
                customers.getCustomerProtectPlanUsage('SOMEOTHERCUSTOMER'),
            ).resolves.toBeNull()
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

    describe('ensureSufficientLicensesInPool', () => {
        it('does nothing if licenses are enough', async () => {
            const updateSpy = jest.spyOn(plans, 'UpdatePowerUserLicensing')
            await (customers as any).ensureSufficientLicensesInPool('plan1', 5, 10)
            expect(updateSpy).not.toHaveBeenCalled()
        })

        it('updates plan licensing if not enough licenses', async () => {
            jest.spyOn(plans, 'getPlans').mockResolvedValue([
                { planId: 'plan1', totalPowerUsers: 50 },
            ])
            const updateSpy = jest.spyOn(plans, 'UpdatePowerUserLicensing').mockResolvedValue([] as any)

            // Need 10, have 2. Additional 8 needed. 8/5 rounded up is 2 packs of 5 = 10 licenses to add.
            // 10 + 50 = 60.
            await (customers as any).ensureSufficientLicensesInPool('plan1', 10, 2)

            expect(updateSpy).toHaveBeenCalledWith('plan1', 60)
        })
    })
})
