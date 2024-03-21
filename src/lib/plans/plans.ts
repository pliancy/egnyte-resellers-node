import { EgnyteConfig, StorageStats, UsageStats } from '../types'
import { Base } from '../base/base'

export class Plans extends Base {
    constructor(_config: EgnyteConfig) {
        super(_config)
    }

    /**
     * retrieves available global licensing for both user and storage that aren't assigned to customers
     * @returns object containing the available user and storage data
     */
    async getPlans(): Promise<any> {
        const { authCookie, csrfToken } = await this.authenticate()
        const planIds = await this._getAllPlanIds(authCookie)

        return Promise.all(
            planIds.map(async (id) => {
                const [planDataRes, planPowerUserDataRes] = await Promise.all([
                    this.http.get<[string, UsageStats][]>(
                        `/msp/usage_stats/${this.resellerId}/${id}/`,
                        {
                            headers: { cookie: authCookie, 'X-CSRFToken': csrfToken },
                        },
                    ),
                    this.http.get(`/msp/get_plan_pu_data/${this.resellerId}/${id}/`, {
                        headers: { cookie: authCookie, 'X-CSRFToken': csrfToken },
                    }),
                ])

                const planData = planDataRes.data
                const planPowerUserData = planPowerUserDataRes.data

                let ref = {} as UsageStats
                if (planData.length > 0) {
                    const entries = Object.entries(planData[0] ?? [])
                    if (entries.length > 0) {
                        ref = (entries[0] ?? [])[1] as UsageStats
                    }
                }

                return {
                    planId: id,
                    totalPowerUsers: planPowerUserData?.purchased,
                    usedPowerUsers: planPowerUserData?.purchased
                        ? planPowerUserData?.purchased - ref.power_user_stats?.Available
                        : undefined,
                    availablePowerUsers: ref.power_user_stats?.Available,
                    availableStorage: ref.storage_stats?.Available,
                    customers: planData.map((customer: object) => Object.keys(customer)[0]),
                }
            }),
        )
    }

    /**
     * retrieves all protect plans
     * @returns array containing the available plans
     */
    async getAllProtectPlans(): Promise<StorageStats[]> {
        const { authCookie, csrfToken } = await this.authenticate()
        const { data: protectUsage } = await this.http.get(
            `/msp/usage_stats/${this.resellerId}/${this.config.protectPlanId}/`,
            {
                headers: { cookie: authCookie, 'X-CSRFToken': csrfToken },
            },
        )

        return protectUsage
    }

    /**
     * Updates a plan's power user licensing count. This will result in a billing change from egnyte. Must be increased in increments of 5
     * @param planId the planId to update licensing for
     * @param newTotalLicenses the new total in increments of 5. Use getPlans() to find current total for given plan
     */
    async UpdatePowerUserLicensing(planId: string, newTotalLicenses: number) {
        const { authCookie, csrfToken } = await this.authenticate()
        const { data: res } = await this.http.post(
            `https://resellers.egnyte.com/msp/change_plan_power_users/${this.resellerId}/`,
            {
                plan_id: planId,
                plan_power_users: newTotalLicenses.toString(),
            },
            {
                headers: {
                    Cookie: `${authCookie}; csrftoken=${csrfToken}`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrfToken,
                    Referer: 'https://resellers.egnyte.com',
                },
            },
        )

        if (res.success !== true) throw new Error(res.msg)
        return (await this.getPlans()).filter((e: any) => e.planId === planId)
    }

    /**
     * gets all unique planIds
     * @param authCookie authCookie from authenticate() call
     * @returns array of planIds
     */
    async _getAllPlanIds(authCookie: string): Promise<string[]> {
        if (!authCookie) throw new Error('missing authCookie')
        if (!this.resellerId) await this.setResellerId(authCookie)

        const { data: res } = await this.http.get(`/msp/customer_data/${this.resellerId}`, {
            headers: { cookie: authCookie },
        })
        return res
            .filter((customer: any) => customer.status !== 'deleted')
            .map((customer: any) => customer.plan_id.toString())
            .filter((v: any, i: any, s: any) => s.indexOf(v) === i)
    }
}
