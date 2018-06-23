import qs from 'querystring'
import got from 'got'

interface IEgnyteCustomer {
  customerEgnyteId: string
  powerUsers: { total: number, used: number, free: number }
  storageGB: { total: number, used: number, free: number }
}

interface IEgnyteLicensingResponse {
  powerUsersAvailable: number
  storageGBAvailable: number
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
  planId?: string
}

interface IEgnyteConfig {
  /** the egnyte resellers portal username */
  username: string
  /** the egnyte resellers portal password */
  password: string
  resellerId?: string
  planId?: string
}

interface IGotConfigBase {
  timeout: number
  followRedirect: boolean
}

interface IEgnyteRawPowerUserAndStorage {
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
      resellerId: config.resellerId || '',
      planId: config.planId || ''
    }
    this._gotConfigBase = {
      timeout: config.timeoutMs || 20000,
      followRedirect: false
    }
  }

  async _getCurrentConfig (): Promise<object> {
    if (!this._config.resellerId || !this._config.planId) await this._authenticate(this._config.username, this._config.password)
    return this._config
  }

  /**
   * Gets a csrf token and returns it
   * @returns the csrf token
   */
  async _getCsrfToken (): Promise<string> {
    try {
      const query = await got('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/', { ...this._gotConfigBase })
      const csrfRegexp = query.body.match(/id='csrfmiddlewaretoken'.*value='([a-zA-Z0-9]+)'.*\n/)
      if (!csrfRegexp) throw new Error('unable to find token in page')
      return csrfRegexp[1]
    } catch (err) {
      throw err
    }
  }

  /**
   * Gets the resellerId for the logged in reseller by parsing out of the 302 from server
   * @param authCookie authCookie from _authenticate() call
   * @returns resellerId in string form
   */
  async _getResellerId (authCookie: string): Promise<string> {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      const query = await got('https://resellers.egnyte.com/customer/browse/', {
        ...this._gotConfigBase,
        headers: { 'cookie': authCookie }
      })
      if (query.statusCode === 302) {
        let location = query.headers.location
        if (!location) throw new Error('unable to find location header in response')
        return location.split('/')[5]
      } else {
        throw new Error('an error occurred attempting to get the resellerId')
      }
    } catch (err) {
      throw err
    }
  }

  /**
   * Gets the planId for the logged in reseller by parsing out of the customer_data API call
   * @param authCookie authCookie from _authenticate() call
   * @returns planId in string form
   */
  async _getPlanId (authCookie: string): Promise<string> {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      let resellerId = await this._getResellerId(authCookie)
      const query = await got(`https://resellers.egnyte.com/msp/customer_data/${resellerId}`, {
        ...this._gotConfigBase,
        headers: { 'cookie': authCookie },
        json: true
      })
      return query.body[0].plan_id.toString()
    } catch (err) {
      throw err
    }
  }

  /**
   * authenticate to egnyte api. gets auth cookie
   * @param username the username for auth
   * @param password the passworf for auth
   * @returns the auth cookie string
   */
  async _authenticate (username: string, password: string): Promise<string> {
    try {
      if (!username || !password) throw new Error('Missing username or password. Unable to authenticate.')
      let csrfToken = await this._getCsrfToken()
      let auth = await got('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/', {
        ...this._gotConfigBase,
        method: 'post',
        body: `csrfmiddlewaretoken=${csrfToken}&username=${qs.escape(username)}&password=${qs.escape(password)}&this_is_the_login_form=1`
      })
      if (auth.statusCode === 302) {
        let setCookieHeader = auth.headers['set-cookie']
        if (!setCookieHeader) throw new Error('unable to find set-cookie header in response')
        let authCookie = setCookieHeader[0].split(';')[0]
        if (!this._config.resellerId || !this._config.planId) {
          let [resellerId, planId] = await Promise.all([
            this._getResellerId(authCookie),
            this._getPlanId(authCookie)
          ])
          this._config.resellerId = resellerId
          this._config.planId = planId
        }
        return authCookie
      } else {
        throw new Error('Authentication failed. Bad username or password.')
      }
    } catch (err) {
      throw err
    }
  }

  /**
   * gets all the customer power users from egnyte in raw form
   * @param authCookie authCookie from _authenticate() call
   * @returns array of customers with powerusers data
   */
  async _getAllPowerUsers (authCookie: string): Promise<IEgnyteRawPowerUserAndStorage[]> {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      let response = await got(`https://resellers.egnyte.com/msp/power_users/${this._config.resellerId}/${this._config.planId}/`, {
        ...this._gotConfigBase,
        headers: { 'cookie': authCookie },
        json: true
      })
      return await response.body
    } catch (err) {
      throw err
    }
  }

  /**
   * gets all the customer storage from egnyte
   * @param authCookie authCookie from _authenticate() call
   * @returns array of customers with storage data
   */
  async _getAllStorage (authCookie: string): Promise<IEgnyteRawPowerUserAndStorage[]> {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      let response = await got(`https://resellers.egnyte.com/msp/storage/${this._config.resellerId}/${this._config.planId}/`, {
        ...this._gotConfigBase,
        headers: { 'cookie': authCookie },
        json: true
      })
      return await response.body
    } catch (err) {
      throw err
    }
  }

  /**
   * retrieves all customer data from multiple egnyte resellers API endpoints and models it to be actually readable
   * @returns array of customer objects containing useful stuff
   */
  async getAllCustomers (): Promise<IEgnyteCustomer[]> {
    try {
      let authCookie = await this._authenticate(this._config.username, this._config.password)
      let [puData, sData] = await Promise.all([
        this._getAllPowerUsers(authCookie),
        this._getAllStorage(authCookie)
      ])
      let result = puData.map(customerPowerUserData => {
        let customerStorageData = sData.filter(data => data.Domain === customerPowerUserData.Domain)[0]
        let result: IEgnyteCustomer = {
          customerEgnyteId: customerPowerUserData.Domain,
          powerUsers: {
            total: customerPowerUserData.Used + customerPowerUserData.Unused,
            used: customerPowerUserData.Used,
            free: customerPowerUserData.Unused
          },
          storageGB: {
            total: customerStorageData.Used + customerStorageData.Unused,
            used: customerStorageData.Used,
            free: customerStorageData.Unused
          }
        }
        return result
      })
      return result
    } catch (err) {
      throw err
    }
  }

  /**
   * retrieves one customer's data from multiple egnyte resellers API endpoints and models it to be actually readable
   * @param customerId the customerId you want to return data on
   * @returns the customer object containing useful stuff
   */
  async getOneCustomer (customerId: string): Promise<IEgnyteCustomer> {
    try {
      let allCustomers = await this.getAllCustomers()
      let customer = allCustomers.find(customer => customer.customerEgnyteId === customerId)
      if (!customer) throw new Error(`unable to find egnyte customer: ${customerId}`)
      return customer
    } catch (err) {
      throw err
    }
  }

  /**
   * retrieves available global licensing for both user and storage that isn't assigned to customers
   * @returns object containing the available user and storage data
   */
  async getAvailableLicensing (): Promise<IEgnyteLicensingResponse> {
    try {
      let authCookie = await this._authenticate(this._config.username, this._config.password)
      let [puData, sData] = await Promise.all([
        this._getAllPowerUsers(authCookie),
        this._getAllStorage(authCookie)
      ])
      let result: IEgnyteLicensingResponse = {
        powerUsersAvailable: puData[0].Available,
        storageGBAvailable: sData[0].Available
      }
      return result
    } catch (err) {
      throw err
    }
  }

  /**
   * Updates a customer with a new power user count
   * @param customerId customer 'domain' key from getAllPowerUsers()
   * @param numOfUsers how many licenses to assign to customer
   * @returns response object
   */
  async updateCustomerPowerUsers (customerId: string, numOfUsers: number): Promise<IEgnyteUpdateResponse> {
    try {
      customerId = customerId.toLowerCase()
      let customer = await this.getOneCustomer(customerId)
      if (numOfUsers < customer.powerUsers.used) {
        let response: IEgnyteUpdateResponse = {
          result: 'NO_CHANGE',
          message: `customerId ${customerId} currently has ${customer.powerUsers.used} power users in use. Refusing to set to ${numOfUsers} power users.`
        }
        return response
      } else if (numOfUsers === customer.powerUsers.total) {
        let response: IEgnyteUpdateResponse = {
          result: 'NO_CHANGE',
          message: `customerId ${customerId} is already set to ${numOfUsers} power users. Did not modify.`
        }
        return response
      }
      let authCookie = await this._authenticate(this._config.username, this._config.password)
      let response = await got(`https://resellers.egnyte.com/msp/change_power_users/${this._config.resellerId}/`, {
        ...this._gotConfigBase,
        method: 'post',
        headers: {
          'Cookie': authCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          domain: customerId,
          power_users: numOfUsers.toString()
        })
      })
      let result = JSON.parse(response.body)
      if (result.msg === 'Plan updated successfully!') {
        let response: IEgnyteUpdateResponse = {
          result: 'SUCCESS',
          message: `Updated customerId ${customerId} from ${customer.powerUsers.total} to ${numOfUsers} power users successfully.`
        }
        return response
      } else {
        throw new Error(result)
      }
    } catch (err) {
      throw err
    }
  }

  /**
   * Updates a customer with a new storage size
   * @param customerId customer 'domain' key from getAllStorage()
   * @param storageSizeGb how much storage the customer should have in GB
   * @returns response object
   */
  async updateCustomerStorage (customerId: string, storageSizeGb: number): Promise<IEgnyteUpdateResponse> {
    try {
      customerId = customerId.toLowerCase()
      let customer = await this.getOneCustomer(customerId)
      if (storageSizeGb < customer.storageGB.used) {
        let response: IEgnyteUpdateResponse = {
          result: 'NO_CHANGE',
          message: `customerId ${customerId} currently has ${customer.storageGB.used}GB storage in use. Refusing to set to ${storageSizeGb}GB storage.`
        }
        return response
      } else if (storageSizeGb === customer.storageGB.total) {
        let response: IEgnyteUpdateResponse = {
          result: 'NO_CHANGE',
          message: `customerId ${customerId} is already set to ${storageSizeGb}GB storage. Did not modify.`
        }
        return response
      }
      let authCookie = await this._authenticate(this._config.username, this._config.password)
      let response = await got(`https://resellers.egnyte.com/msp/change_storage/${this._config.resellerId}/`, {
        ...this._gotConfigBase,
        method: 'post',
        headers: {
          'Cookie': authCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          domain: customerId,
          storage: storageSizeGb.toString()
        })
      })
      let result = JSON.parse(response.body)
      if (result.msg === 'Plan updated successfully!') {
        let response: IEgnyteUpdateResponse = {
          result: 'SUCCESS',
          message: `Updated customerId ${customerId} from ${customer.storageGB.total}GB to ${storageSizeGb}GB storage successfully.`
        }
        return response
      } else {
        throw new Error(result)
      }
    } catch (err) {
      throw err
    }
  }
}

export = Egnyte
