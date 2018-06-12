const qs = require('querystring')
const fetch = require('isomorphic-fetch')

// we wrap our class in an IIFE so we can have private methods/variables outside of our class through closure.
const Egnyte = (function () {
  /**
   * Gets a csrf token and returns it
   * @returns {string} the csrf token
   */
  async function _getCsrfToken () {
    try {
      const query = await fetch('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/')
      let html = await query.text()
      let csrfToken = html.match(/id='csrfmiddlewaretoken'.*value='([a-zA-Z0-9]+)'.*\n/)[1]
      return csrfToken
    } catch (err) {
      throw err
    }
  }

  /**
   * Gets the resellerId for the logged in reseller by parsing out of the 302 from server
   * @param {string} authCookie authCookie from _authenticate() call
   * @returns {string} resellerId in string form
   */
  async function _getResellerId (authCookie) {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      const query = await fetch('https://resellers.egnyte.com/customer/browse/', { headers: { 'cookie': authCookie }, redirect: 'manual' })
      if (query.status === 302) {
        let resellerId = query.headers._headers.location[0].split('/')[5]
        return resellerId
      } else {
        throw new Error('an error occurred attempting to get the resellerId')
      }
    } catch (err) {
      throw err
    }
  }

  /**
   * Gets the planId for the logged in reseller by parsing out of the customer_data API call
   * @param {string} authCookie authCookie from _authenticate() call
   * @returns {string} planId in string form
   */
  async function _getPlanId (authCookie) {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      let resellerId = await _getResellerId(authCookie)
      const query = await fetch(`https://resellers.egnyte.com/msp/customer_data/${resellerId}`, { headers: { 'cookie': authCookie } })
      let result = await query.json()
      return result[0].plan_id
    } catch (err) {
      throw err
    }
  }

  /**
   * authenticate to egnyte api. gets auth cookie
   * @param {string} username the username for auth
   * @param {string} password the passworf for auth
   * @returns {string} the auth cookie string
   */
  async function _authenticate (username, password) {
    try {
      let csrfToken = await _getCsrfToken()
      if (!username || !password) throw new Error('Missing username or password. Unable to authenticate.')
      let auth = await fetch('https://resellers.egnyte.com/accounts/login/?next=/customer/browse/', {
        method: 'post',
        body: `csrfmiddlewaretoken=${csrfToken}&username=${qs.escape(username)}&password=${qs.escape(password)}&this_is_the_login_form=1`,
        redirect: 'manual'
      })
      if (auth.status === 302) {
        let cookie = auth.headers._headers['set-cookie'][0].split(';')[0]
        return cookie
      } else {
        throw new Error('Authentication failed. Bad username or password.')
      }
    } catch (err) {
      throw err
    }
  }

  /**
   * gets all the customer power users from egnyte
   * @param {string} authCookie authCookie from _authenticate() call
   * @returns {object[]} array of customers with powerusers data
   */
  async function _getAllPowerUsers (authCookie) {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      let resellerId = await _getResellerId(authCookie)
      let planId = await _getPlanId(authCookie)
      let response = await fetch(`https://resellers.egnyte.com/msp/power_users/${resellerId}/${planId}/`, { headers: { 'cookie': authCookie } })
      return await response.json()
    } catch (err) {
      throw err
    }
  }

  /**
   * gets all the customer storage from egnyte
   * @param {string} authCookie authCookie from _authenticate() call
   * @returns {object[]} array of customers with storage data
   */
  async function _getAllStorage (authCookie) {
    try {
      if (!authCookie) throw new Error('missing authCookie')
      let resellerId = await _getResellerId(authCookie)
      let planId = await _getPlanId(authCookie)
      let response = await fetch(`https://resellers.egnyte.com/msp/storage/${resellerId}/${planId}/`, { headers: { 'cookie': authCookie } })
      return await response.json()
    } catch (err) {
      throw err
    }
  }

  // the class that we'll return from the IIFE
  class Egnyte {
    constructor (config = {}) {
      this._config = {
        username: config.username || '',
        password: config.password || ''
      }
    }

    /**
     * retrieves customer data from multiple egnyte resellers API endpoints and models it to be actually readable
     * @returns {object[]} array of customer objects containing useful stuff
     */
    async getAllCustomers () {
      try {
        let result = []
        let authCookie = await _authenticate(this._config.username, this._config.password)
        let [puData, sData] = await Promise.all([
          _getAllPowerUsers(authCookie),
          _getAllStorage(authCookie)
        ])
        for (let customerPowerUserData of puData) {
          let customerStorageData = sData.filter(data => data.Domain === customerPowerUserData.Domain)[0]
          let customerObject = {
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
          result.push(customerObject)
        }
        return result
      } catch (err) {
        throw err
      }
    }

    /**
     * retrieves available global licensing for both user and storage that isn't assigned to customers
     * @returns {object} object containing the available user and storage data
     */
    async getAvailableLicensing () {
      try {
        let authCookie = await _authenticate(this._config.username, this._config.password)
        let [puData, sData] = await Promise.all([
          _getAllPowerUsers(authCookie),
          _getAllStorage(authCookie)
        ])
        return {
          powerUsersAvailable: puData[0].Available,
          storageGBAvailable: sData[0].Available
        }
      } catch (err) {
        throw err
      }
    }

    /**
     * Updates a customer with a new power user count
     * @param {string} customerId customer 'domain' key from getAllPowerUsers()
     * @param {number} numOfUsers how many licenses to assign to customer
     */
    async updateCustomerPowerUsers (customerId, numOfUsers) {
      return {}
    }

    /**
     * Updates a customer with a new storage size
     * @param {string} customerId customer 'domain' key from getAllStorage()
     * @param {number} storageSizeGb how much storage the customer should have in GB
     */
    async updateCustomerStorage (customerId, storageSizeGb) {
      return {}
    }
  }

  // return the class
  return Egnyte
})()

// export our class definition with the closure
module.exports = Egnyte
