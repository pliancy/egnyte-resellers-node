import { EgnyteConfig } from '../types'
import { Base } from '../base/base'

export class Users extends Base {
    constructor(_config: EgnyteConfig) {
        super(_config)
    }

    getStandardUsers() {}
}
