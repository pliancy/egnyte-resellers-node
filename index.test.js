import Egnyte from './index.js'

let egnyte = new Egnyte({
  username: 'fake@fake.com',
  password: 'veryfake'
})

describe('Helpers',() => {
  it('Gets CSRF token', async () => {
    let _getCsrfToken = Egnyte.__get__('_getCsrfToken')
    let result = await _getCsrfToken()
    expect(result).toMatch(/[a-f0-9]/)
  })
})
