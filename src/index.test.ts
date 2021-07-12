// import Egnyte from './index'

// const egnyte = new Egnyte({
//   username: 'a',
//   password: 'b'
// })

import Egnyte from './index'

describe('http config', () => {
    it('defaults to a 20000ms timeout given timeoutMs is undefined', async () => {
        const ern = new Egnyte({
            username: 'user',
            password: 'pass',
        })

        expect(ern['httpConfig'].timeout).toBe(20000)
    })

    it('defaults to a 20000ms timeout given timeoutMs is not parsable as an integer', async () => {
        const ern = new Egnyte({
            username: 'user',
            password: 'pass',
            timeoutMs: 'NotANumber' as any,
        })

        expect(ern['httpConfig'].timeout).toBe(20000)
    })

    it('sets timeout given timeoutMs is parsable as an integer', async () => {
        const ern = new Egnyte({
            username: 'user',
            password: 'pass',
            timeoutMs: '30000,' as any,
        })

        expect(ern['httpConfig'].timeout).toBe(30000)
    })
})

// describe('Helpers', () => {
//   beforeEach(() => {
//     fetch.resetMocks()
//   })

//   xit('Gets CSRF token', async () => {
//     fetch.mockResponse(`<div id="leftcolumn" class="leftcolumn-center login-area">
//     <div class="modulehead">Login</div>
//     <div id="userlist" class="userlist-full editlist" style="background-color: #f5f5ef;">

//       <form action="" method="post" id="login-form"><div style='display:none;'><input type='hidden' id='csrfmiddlewaretoken' name='csrfmiddlewaretoken' value='fec9a59a86510210de334ca4e251ed3d' /></div>
//               <p><label for="id_username">Username:</label> <input id="id_username" type="text" name="username" maxlength="100" /></p>
//   <p><label for="id_password">Password:</label> <input type="password" name="password" id="id_password" /></p>

//         <input type="hidden" name="this_is_the_login_form" value="1" />
//         <input type="submit" class="button" value="Log in" />
//       </form>
//           <ul>
//             <li><a href="/accounts/recover_account/">Can't access your account?</a></li>
//           </ul>
//       </div>
//   </div>
//   `, { headers: { 'location': [ 'test' ] } })
//     let result = await egnyte._getCsrfToken()
//     return expect(result).toEqual('fec9a59a86510210de334ca4e251ed3d')
//   })

//   xit('Gets resellerId from header', async () => {
//     fetch.mockResponse(`who cares`, { headers: { location: 'https://resellers.egnyte.com/msp/plan/12345/' }, status: 302 })
//     let result = await egnyte._getResellerId('mycookie=cool')
//     return expect(result).toEqual('12345')
//   })
// })
