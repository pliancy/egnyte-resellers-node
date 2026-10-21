import { chromium, type Browser, type BrowserContext } from 'playwright'

const PORTAL_LOGIN_URL = 'https://resellers.egnyte.com/accounts/login/'
const PORTAL_ORIGIN = 'https://resellers.egnyte.com'

export interface PortalLoginOptions {
    username: string
    password: string
    /** @default true */
    headless?: boolean
    /** Max time to wait for login navigation (ms). @default 60000 */
    loginTimeoutMs?: number
}

export interface PortalLoginResult {
    /** Portal session cookie pair, e.g. `sessionid=...` or `pbapp3sess=...` */
    authCookie: string
    csrfToken: string
}

/** Known Egnyte reseller portal session cookie names (legacy Django + current app). */
const PORTAL_SESSION_COOKIE_NAMES = ['sessionid', 'pbapp3sess'] as const

/**
 * Logs into the Egnyte reseller portal in a real browser so invisible reCAPTCHA can run.
 */
export async function loginResellerPortal(options: PortalLoginOptions): Promise<PortalLoginResult> {
    const headless = options.headless ?? true
    const loginTimeoutMs = options.loginTimeoutMs ?? 60_000

    let browser: Browser | undefined
    try {
        browser = await chromium.launch({ headless })
        const context = await browser.newContext()
        const page = await context.newPage()

        await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded' })

        const emailField = page
            .locator('#email, input[name="email"], input[name="username"], #id_username')
            .first()
        const passwordField = page
            .locator('#password, input[name="password"], #id_password')
            .first()
        await emailField.waitFor({ state: 'visible', timeout: loginTimeoutMs })
        await emailField.fill(options.username)
        await passwordField.fill(options.password)

        await waitForRecaptchaReady(page, loginTimeoutMs)

        const submit = page
            .locator(
                'button[type="submit"], input[type="submit"], button[name="login"], #login-button',
            )
            .first()

        const loginPost = page.waitForResponse(
            (response) =>
                response.request().method() === 'POST' &&
                response.url().includes('/accounts/login'),
            { timeout: loginTimeoutMs },
        )

        await submit.click()

        const response = await loginPost.catch(() => undefined)
        if (response && response.status() >= 400) {
            throw new Error(
                `Portal login POST failed with HTTP ${response.status()}. Check credentials or reCAPTCHA.`,
            )
        }

        await page.waitForLoadState('networkidle', { timeout: loginTimeoutMs }).catch(() => {})

        const session = await pollForSessionCookie(context, loginTimeoutMs)
        const csrf = (await context.cookies()).find((c) => c.name === 'csrftoken')

        if (!session?.value) {
            const url = page.url()
            const cookieNames = (await context.cookies()).map((c) => c.name).join(', ') || '(none)'
            const loginError = await readLoginErrorText(page)
            throw new Error(
                [
                    'Portal login did not yield a session cookie.',
                    `url=${url}`,
                    `cookies=${cookieNames}`,
                    loginError ? `message=${loginError}` : 'Check username/password or reCAPTCHA.',
                ].join(' '),
            )
        }
        if (!csrf?.value) {
            throw new Error('Portal login did not yield a csrftoken cookie.')
        }

        return {
            authCookie: `${session.name}=${session.value}`,
            csrfToken: csrf.value,
        }
    } finally {
        await browser?.close()
    }
}

function findPortalSessionCookie(
    cookies: { name: string; value: string }[],
): { name: string; value: string } | undefined {
    for (const name of PORTAL_SESSION_COOKIE_NAMES) {
        const match = cookies.find((c) => c.name === name)
        if (match?.value) {
            return match
        }
    }
    return cookies.find(
        (c) =>
            c.name !== 'csrftoken' &&
            c.name !== '_GRECAPTCHA' &&
            (c.name.endsWith('sess') || c.name.toLowerCase().includes('session')),
    )
}

async function pollForSessionCookie(
    context: BrowserContext,
    timeoutMs: number,
): Promise<{ name: string; value: string } | undefined> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const cookies = await context.cookies(PORTAL_ORIGIN)
        const session = findPortalSessionCookie(cookies)
        if (session?.value) {
            return session
        }
        await sleep(250)
    }
    return undefined
}

async function readLoginErrorText(page: import('playwright').Page): Promise<string | undefined> {
    const locator = page.locator(
        '.errorlist, .alert-danger, .alert-error, [role="alert"], .invalid-feedback',
    )
    const text = (
        await locator
            .first()
            .textContent({ timeout: 2000 })
            .catch(() => null)
    )?.trim()
    return text || undefined
}

async function waitForRecaptchaReady(
    page: import('playwright').Page,
    timeoutMs: number,
): Promise<void> {
    await page
        .waitForFunction(
            "typeof grecaptcha !== 'undefined' && typeof grecaptcha.execute === 'function'",
            { timeout: timeoutMs },
        )
        .catch(() => {
            /* Some builds load recaptcha only on submit; continue to click. */
        })
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
