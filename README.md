# Egnyte Resellers API

Library for managing things against the undocumented egnyte resellers API.

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
//     "customerEgnyteId": "mycustomersname",
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
```

this is still unfinished... need to do more than read things. will finish soonish...
