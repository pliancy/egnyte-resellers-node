# Egnyte Resellers API

Library for managing things against the undocumented egnyte resellers API.

All methods are implemented in async/await so use you must use async/await or promises to interact with them. Below examples show promise.then().catch() syntax for clarity

I made this to solve my own problems of automating modifications to a resellers account for egnyte. Use at your own risk.

Basic usage:

```js
const Egnyte = require('egnyte-resellers')

// create an instance of the egnyte class
let egnyte = new Egnyte({
  username: 'myusername@company.com',
  password: 'mydefinitelygoodpassword'
})

// get information about your customer tenants
// returns an array like this:
//
// [
//   ...
//   {
//     "customerEgnyteId": "thecustomerid",
//     "powerUsers": {
//       "total": 5,
//       "active": 1,
//       "free": 4
//     },
//     "storageGB": {
//       "total": 500,
//       "active": 200,
//       "free": 300
//     }
//   }
// ]
//
egnyte.getAllCustomers()
  .then(result => {
    // do something with result
  })
  .catch(err => {
    // handle your errors friends!
  })

// get a single customer instead of an array of them
egnyte.getOneCustomer('thecustomerid')
  .then(result => {
    // do something with result
  })
  .catch(err => {
    // handle your errors friends!
  })

// get your resellers account license availability
// returns an object like this:
//
// {
//   powerUsersAvailable: 14,
//   storageGBAvailable: 3142
// }
//
egnyte.getAvailableLicensing()
  .then(result => {
    // do something with result
  })
  .catch(err => {
    // handle your errors friends!
  })

// updates a customer's power user count
// since egnyte doesn't do it for whatever genius reason, we'll do validation to ensure you can't set this to less than the current in-use number of users
//
// sets thecustomerid to 20 user count
egnyte.updateCustomerPowerUsers('thecustomerid', 20)
  .then(result => {
    // do something with result
  })
  .catch(err => {
    // handle your errors friends!
  })

// updates a customer's storage GB count
// since egnyte doesn't do it for whatever genius reason, we'll do validation to ensure you can't set this to less than the current in-use GB of storage
//
// sets thecustomerid to 500GB storage allocation
egnyte.updateCustomerStorage('thecustomerid', 500)
  .then(result => {
    // do something with result
  })
  .catch(err => {
    // handle your errors friends!
  })
```
