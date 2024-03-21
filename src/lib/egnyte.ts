import { EgnyteConfig } from './types'
import { Customers } from './customers/customers'
import { Plans } from './plans/plans'
import { Users } from './users/users'

export class Egnyte {
    customers: Customers

    plans: Plans

    users: Users

    /**
     * Instantiates Egnyte APIs
     *
     * @param {EgnyteConfig} config - The configuration object for Egnyte.
     */
    constructor(private readonly config: EgnyteConfig) {
        this.plans = new Plans(this.config)
        this.customers = new Customers(this.plans, this.config)
        this.users = new Users(this.config)
    }
}
