import qs from 'querystring'
import fetch from 'node-fetch'

interface IEgnyteCustomer {
  customerEgnyteId: string,
  powerUsers: { total: number, used: number, free: number },
  storageGB: { total: number, used: number, free: number }
}

interface IEgnyteLicensingResponse {
  powerUsersAvailable: number,
  storageGBAvailable: number
}

interface IEgnyteUpdateResponse {
  result: string,
  message: string
}

interface IEgnyteConfig {
  /** the egnyte resellers portal username */
  username: string,
  /** the egnyte resellers portal password */
  password: string
}

interface IEgnyteRawPowerUserAndStorage {
  Used: number,
  Unused: number,
  Available: number,
  Domain: string
}

class Egnyte {
  _config: IEgnyteConfig
  /**
   * Creates an instance of Egnyte.
   * @param config the config object
   * @memberof Egnyte
   */
  constructor (config: IEgnyteConfig) {
    if (!config.username || !config.password) throw new Error('missing config values username or password when calling the Egnyte constructor')
    this._config = {
      username: config.username,
      password: config.password
    }
  }

  /**
   * Gets a csrf token and returns it
   * @returns the csrf token
   */
  async _getCsrfToken (): Promise<string> {
    try {
      const query = await fetch('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/')
      const html = await query.text()
      const csrfRegexp = html.match(/id='csrfmiddlewaretoken'.*value='([a-zA-Z0-9]+)'.*\n/)
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
      const query = await fetch('https://resellers.egnyte.com/customer/browse/', { headers: { 'cookie': authCookie }, redirect: 'manual' })
      if (query.status === 302) {
        let location = query.headers.get('location')
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
      const query = await fetch(`https://resellers.egnyte.com/msp/customer_data/${resellerId}`, { headers: { 'cookie': authCookie } })
      let result = await query.json()
      return result[0].plan_id
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
      let csrfToken = await this._getCsrfToken()
      if (!username || !password) throw new Error('Missing username or password. Unable to authenticate.')
      let auth = await fetch('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/', {
        method: 'post',
        body: `csrfmiddlewaretoken=${csrfToken}&username=${qs.escape(username)}&password=${qs.escape(password)}&this_is_the_login_form=1`,
        redirect: 'manual'
      })
      if (auth.status === 302) {
        let setCookieHeader = auth.headers.get('set-cookie')
        if (!setCookieHeader) throw new Error('unable to find set-cookie header in response')
        return setCookieHeader.split(';')[0]
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
      let resellerId = await this._getResellerId(authCookie)
      let planId = await this._getPlanId(authCookie)
      let response = await fetch(`https://resellers.egnyte.com/msp/power_users/${resellerId}/${planId}/`, { headers: { 'cookie': authCookie } })
      return await response.json()
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
      let resellerId = await this._getResellerId(authCookie)
      let planId = await this._getPlanId(authCookie)
      let response = await fetch(`https://resellers.egnyte.com/msp/storage/${resellerId}/${planId}/`, { headers: { 'cookie': authCookie } })
      return await response.json()
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
      if (customerId === undefined || numOfUsers === undefined) throw new Error('missing customerId or numOfUsers')
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
      let resellerId = await this._getResellerId(authCookie)
      let response = await fetch(`https://resellers.egnyte.com/msp/change_power_users/${resellerId}/`, {
        method: 'POST',
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
      let result = await response.json()
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
      if (customerId === undefined || storageSizeGb === undefined) throw new Error('missing customerId or storageSizeGb')
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
      let resellerId = await this._getResellerId(authCookie)
      let response = await fetch(`https://resellers.egnyte.com/msp/change_storage/${resellerId}/`, {
        method: 'POST',
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
      let result = await response.json()
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
