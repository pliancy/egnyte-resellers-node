import { Egnyte } from './egnyte'
import { EgnyteConfig } from './types'
import { Plans } from './plans/plans'
import { Customers } from './customers/customers'
import { Users } from './users/users'

describe('Egnyte', () => {
    let config: EgnyteConfig
    let egnyte: Egnyte

    beforeEach(() => {
        config = {
            username: 'username',
            password: 'password',
        }
        egnyte = new Egnyte(config)
    })

    it('creates an Egnyte instance with the expected dependencies', () => {
        expect(egnyte.customers).toBeInstanceOf(Customers)
        expect(egnyte.users).toBeInstanceOf(Users)
        expect(egnyte.plans).toBeInstanceOf(Plans)
    })
})
