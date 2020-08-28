import qs from 'querystring'
import got from 'got'

interface IEgnyteCustomer {
  customerEgnyteId: string
  planId: string
  powerUsers: {
    total: number
    used: number
    available: number
    free: number
  }
  storageGB: {
    total: number
    used: number
    available: number
    free: number
  }
}

interface IEgnyteUpdateResponse {
  result: string
  message: string
}

interface IEgnyteConstructorConfig {
  username: string
  password: string
  timeoutMs?: number
  resellerId?: string
  forceLicenseChange?: boolean
}

interface IEgnyteConfig {
  /** the egnyte resellers portal username */
  username: string
  /** the egnyte resellers portal password */
  password: string
  resellerId?: string
  forceLicenseChange?: boolean
}

interface IGotConfigBase {
  timeout: number
  followRedirect: boolean
}

interface IEgnyteRawPowerUserAndStorage{
  Used: number
  Unused: number
  Available: number
  Domain: string
}

class Egnyte {
  _config: IEgnyteConfig
  _gotConfigBase: IGotConfigBase
  /**
   * Creates an instance of Egnyte.
   * @param config the config object
   * @memberof Egnyte
   */
  constructor (config: IEgnyteConstructorConfig) {
    if (!config.username || !config.password) throw new Error('missing config values username or password when calling the Egnyte constructor')
    this._config = {
      username: config.username,
      password: config.password,
      resellerId: config.resellerId ?? '',
      forceLicenseChange: config.forceLicenseChange ?? false
    }
    this._gotConfigBase = {
      timeout: config.timeoutMs ?? 20000,
      followRedirect: false
    }
  }

  /**
   * Gets a csrf token and returns it
   * @returns the csrf token
   */
  private async _getCsrfToken (): Promise<string> {
    const query = await got('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/', { ...this._gotConfigBase })
    const csrfRegexp = query.body.match(/id='csrfmiddlewaretoken'.*value='([a-zA-Z0-9]+)'.*\n/)
    if (!csrfRegexp) throw new Error('unable to find token in page')
    return csrfRegexp[1]
  }

  /**
   * Gets the resellerId for the logged in reseller by parsing out of the 302 from server
   * @param authCookie authCookie from _authenticate() call
   * @returns resellerId in string form
   */
  private async _getResellerId (authCookie: string): Promise<string> {
    if (!authCookie) throw new Error('missing authCookie')
    const query = await got('https://resellers.egnyte.com/customer/browse/', {
      ...this._gotConfigBase,
      headers: { cookie: authCookie }
    })
    if (query.statusCode === 302) {
      const location = query.headers.location
      if (!location) throw new Error('unable to find location header in response')
      return location.split('/')[5]
    } else {
      throw new Error('an error occurred attempting to get the resellerId')
    }
  }

  /**
   * gets all unique planIds
   * @param authCookie authCookie from _authenticate() call
   * @returns array of planIds
   */
  private async _getAllPlanIds (authCookie: string): Promise<string[]> {
    if (!authCookie) throw new Error('missing authCookie')
    const resellerId = await this._getResellerId(authCookie)
    const query: any = await got(`https://resellers.egnyte.com/msp/customer_data/${resellerId}`, {
      ...this._gotConfigBase,
      headers: { cookie: authCookie },
      responseType: 'json'
    })
    const resultArray = query.body
      .filter((customer: any) => customer.status !== 'deleted')
      .map((customer: any) => customer.plan_id.toString())
      .filter((v: any, i: any, s: any) => s.indexOf(v) === i)
    return resultArray
  }

  /**
   * authenticate to egnyte api. gets auth cookie
   * @param username the username for auth
   * @param password the passworf for auth
   * @returns the auth cookie string
   */
  private async _authenticate (username: string, password: string): Promise<string> {
    if (!username || !password) throw new Error('Missing username or password. Unable to authenticate.')
    const csrfToken = await this._getCsrfToken()
    const auth = await got('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/', {
      ...this._gotConfigBase,
      method: 'post',
      body: `csrfmiddlewaretoken=${csrfToken}&username=${qs.escape(username)}&password=${qs.escape(password)}&this_is_the_login_form=1`
    })
    if (auth.statusCode === 302) {
      const setCookieHeader = auth.headers['set-cookie']
      if (!setCookieHeader) throw new Error('unable to find set-cookie header in response')
      const authCookie = setCookieHeader[0].split(';')[0]
      if (!this._config.resellerId) {
        const resellerId = await this._getResellerId(authCookie)
        this._config.resellerId = resellerId
      }
      return authCookie
    } else {
      throw new Error('Authentication failed. Bad username or password.')
    }
  }

  /**
   * retrieves all customer data from multiple egnyte resellers API endpoints and models it to be actually readable
   * @returns array of customer objects containing useful stuff
   */
  async getAllCustomers (): Promise<IEgnyteCustomer[]> {
    const authCookie = await this._authenticate(this._config.username, this._config.password)
    const planIds = await this._getAllPlanIds(authCookie)

    const customerStats: any = await Promise.all(planIds.map(id => got(`https://resellers.egnyte.com/msp/usage_stats/${this._config.resellerId}/${id}/`, {
      ...this._gotConfigBase,
      headers: { cookie: authCookie },
      responseType: 'json'
    })))

    const resp: IEgnyteCustomer[] = customerStats.map((e: any) => e.body.map((f: any) => {
      const customerEgnyteId = Object.keys(f)[0]
      const ref = f[customerEgnyteId]
      const obj: IEgnyteCustomer = {
        customerEgnyteId,
        planId: e.requestUrl.split('/')[6],
        powerUsers: {
          total: ref.power_user_stats.Used + ref.power_user_stats.Unused,
          used: ref.power_user_stats.Used,
          available: ref.power_user_stats.Available,
          free: ref.power_user_stats.Unused
        },
        storageGB: {
          total: ref.storage_stats.Used + ref.storage_stats.Unused,
          used: ref.storage_stats.Used,
          available: ref.storage_stats.Available,
          free: ref.storage_stats.Unused
        }
      }
      return obj
    })).flat()

    return resp
  }

  /**
   * retrieves one customer's data from multiple egnyte resellers API endpoints and models it to be actually readable
   * @param customerId the customerId you want to return data on
   * @returns the customer object containing useful stuff
   */
  async getOneCustomer (customerId: string): Promise<IEgnyteCustomer> {
    const allCustomers = await this.getAllCustomers()
    const customer = allCustomers.find(customer => customer.customerEgnyteId === customerId)
    if (!customer) throw new Error(`unable to find egnyte customer: ${customerId}`)
    return customer
  }

  async updateCustomer (customerId: string, data: { powerUsers?: { total?: number }, storageGB?: { total?: number } }) {
    const allCustomers = await this.getAllCustomers()
    const customer = allCustomers.find(customer => customer.customerEgnyteId === customerId)
    if (!customer) throw new Error(`unable to find egnyte customer: ${customerId}`)
    if (data?.powerUsers?.total && data.powerUsers.total !== customer.powerUsers.total) {
      await this.updateCustomerPowerUsers(customerId, data.powerUsers.total)
      customer.powerUsers.total = data.powerUsers.total
      customer.powerUsers.free = data.powerUsers.total - customer.powerUsers.used
    }
    if (data?.storageGB?.total && data.storageGB.total !== customer.storageGB.total) {
      await this.updateCustomerStorage(customerId, data.storageGB.total)
      customer.storageGB.total = data.storageGB.total
      customer.storageGB.free = data.storageGB.total - customer.storageGB.used
    }
    return customer
  }

  /**
   * retrieves available global licensing for both user and storage that isn't assigned to customers
   * @returns object containing the available user and storage data
   */
  async getAvailableLicensing (): Promise<any> {
    const authCookie = await this._authenticate(this._config.username, this._config.password)
    const planIds = await this._getAllPlanIds(authCookie)

    const promises = []

    for (const id of planIds) {
      promises.push(got(`https://resellers.egnyte.com/msp/usage_stats/${this._config.resellerId}/${id}/`, {
        ...this._gotConfigBase,
        headers: { cookie: authCookie },
        responseType: 'json'
      }))
    }

    const result: any[] = await Promise.all(promises)

    const final = []
    for (const i in result) {
      const base = result[i].body[0]
      const arr: any[] = Object.entries(base)[0]
      const data = arr[1]
      final.push({
        planId: planIds[i],
        availablePowerUsers: data.power_user_stats.Available,
        availableStorage: data.storage_stats.Available
      })
    }

    return final
  }

  async UpdatePowerUserLicensing (planId: string, newTotalLicenses: number) {
    const authCookie = await this._authenticate(this._config.username, this._config.password)
    const res: any = await got(`https://resellers.egnyte.com/msp/change_plan_power_users/${this._config.resellerId}/`, {
      ...this._gotConfigBase,
      method: 'post',
      headers: {
        Cookie: authCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      responseType: 'json',
      body: JSON.stringify({
        plan_id: planId,
        plan_power_users: newTotalLicenses.toString()
      })
    })

    if (res.body.success !== true) throw new Error(res.body.msg)
    return (await this.getAvailableLicensing()).filter((e: any) => e.planId === planId)
  }

  /**
   * Updates a customer with a new power user count
   * @param customerId customer 'domain' key from getAllPowerUsers()
   * @param numOfUsers how many licenses to assign to customer
   * @returns response object
   */
  async updateCustomerPowerUsers (customerId: string, numOfUsers: number): Promise<IEgnyteUpdateResponse> {
    customerId = customerId.toLowerCase()
    let customer: any
    try {
      customer = await this.getOneCustomer(customerId)
      if (customer.powerUsers.available <= 0) throw new Error('No available licenses on customers reseller plan.')
      if (numOfUsers < customer.powerUsers.used && this._config.forceLicenseChange !== true) {
        const response: IEgnyteUpdateResponse = {
          result: 'NO_CHANGE',
          message: `customerId ${customerId} currently has ${customer.powerUsers.used} power users in use. Refusing to set to ${numOfUsers} power users.`
        }
        return response
      } else if (numOfUsers === customer.powerUsers.total) {
        const response: IEgnyteUpdateResponse = {
          result: 'NO_CHANGE',
          message: `customerId ${customerId} is already set to ${numOfUsers} power users. Did not modify.`
        }
        return response
      }
      const authCookie = await this._authenticate(this._config.username, this._config.password)
      const response = await got(`https://resellers.egnyte.com/msp/change_power_users/${this._config.resellerId}/`, {
        ...this._gotConfigBase,
        method: 'post',
        headers: {
          Cookie: authCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          domain: customerId,
          power_users: numOfUsers.toString()
        })
      })
      const result = JSON.parse(response.body)
      if (result.msg === 'Plan updated successfully!') {
        const response: IEgnyteUpdateResponse = {
          result: 'SUCCESS',
          message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully.`
        }
        return response
      } else {
        throw new Error(result)
      }
    } catch (err) {
      // catch the case where we set user below current in use but have allowed it via config.forceLicenseChange flag
      if (
        this._config.forceLicenseChange &&
        err.statusCode === 400 &&
        JSON.parse(err.response.body).msg === 'CFS plan upgrade failed. Please contact support.'
      ) {
        const response: IEgnyteUpdateResponse = {
          result: 'SUCCESS',
          message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully.`
        }
        return response
      }
      throw err
    }
  }

  /**
   * Updates a customer with a new storage size
   * @param customerId customer 'domain' key from getAllStorage()
   * @param storageSizeGB how much storage the customer should have in GB
   * @returns response object
   */
  async updateCustomerStorage (customerId: string, storageSizeGB: number): Promise<IEgnyteUpdateResponse> {
    customerId = customerId.toLowerCase()
    const customer = await this.getOneCustomer(customerId)
    if (storageSizeGB < customer.storageGB.used) {
      const response: IEgnyteUpdateResponse = {
        result: 'NO_CHANGE',
        message: `customerId ${customerId} currently has ${customer.storageGB.used}GB storage in use. Refusing to set to ${storageSizeGB}GB storage.`
      }
      return response
    } else if (storageSizeGB === customer.storageGB.total) {
      const response: IEgnyteUpdateResponse = {
        result: 'NO_CHANGE',
        message: `customerId ${customerId} is already set to ${storageSizeGB}GB storage. Did not modify.`
      }
      return response
    }
    const authCookie = await this._authenticate(this._config.username, this._config.password)
    const response = await got(`https://resellers.egnyte.com/msp/change_storage/${this._config.resellerId}/`, {
      ...this._gotConfigBase,
      method: 'post',
      headers: {
        Cookie: authCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        domain: customerId,
        storage: storageSizeGB.toString()
      })
    })
    const result = JSON.parse(response.body)
    if (result.msg === 'Plan updated successfully!') {
      const response: IEgnyteUpdateResponse = {
        result: 'SUCCESS',
        message: `Updated customerId ${customerId} from ${customer.storageGB.total}GB to ${storageSizeGB}GB storage successfully.`
      }
      return response
    } else {
      throw new Error(result)
    }
  }
}

export = Egnyte
