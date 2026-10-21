import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import axios from 'axios'
import { CookieJar } from 'tough-cookie'
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http'

export const PORTAL_ORIGIN = 'https://resellers.egnyte.com'
const PORTAL_LOGIN_URL = `${PORTAL_ORIGIN}/accounts/login/`
const PORTAL_SIGN_IN_URL = `${PORTAL_ORIGIN}/auth/sign-in`
const PORTAL_V2_LOGIN_URL = `${PORTAL_ORIGIN}/v2/accounts/login`

/** Avoid headless-default UA that sometimes receives a stripped login document. */
const PORTAL_BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface PortalLoginOptions {
    username: string
    password: string
    /** @default true */
    headless?: boolean
    /** Max time to wait for login navigation (ms). @default 60000 */
    loginTimeoutMs?: number
    /** Enable Chromium OS sandbox. @default true */
    portalChromiumSandbox?: boolean
    /**
     * @deprecated Insecure: types password into the portal page. Use only if hybrid login fails in your environment.
     * @default false
     */
    portalBrowserSubmitLogin?: boolean
}

export interface PortalLoginResult {
    /** Portal session cookie pair, e.g. `sessionid=...` or `pbapp3sess=...` */
    authCookie: string
    csrfToken: string
}

/** Authenticated app session first; anonymous Django `sessionid` is set on the login page. */
const PORTAL_SESSION_COOKIE_NAMES = ['pbapp3sess', 'sessionid'] as const

const RECAPTCHA_TOKEN_SELECTORS =
    'input[name="recaptcha"], #id_recaptcha, #g-recaptcha-response, textarea[name="g-recaptcha-response"]'

/**
 * Logs into the Egnyte reseller portal: reCAPTCHA in a minimal browser context; login POST uses the
 * same browser cookie jar (password is not typed into the DOM).
 */
export async function loginResellerPortal(options: PortalLoginOptions): Promise<PortalLoginResult> {
    if (options.portalBrowserSubmitLogin) {
        return loginViaBrowserSubmit(options)
    }

    return loginHybridViaBrowserContext(options)
}

/**
 * reCAPTCHA in the browser; credentials submitted with {@link BrowserContext.request} so cookies
 * and CSRF match the page session (axios-only POST breaks reCAPTCHA verification).
 */
async function loginHybridViaBrowserContext(
    options: PortalLoginOptions,
): Promise<PortalLoginResult> {
    const headless = options.headless ?? true
    const loginTimeoutMs = options.loginTimeoutMs ?? 60_000
    const chromiumSandbox = options.portalChromiumSandbox ?? true

    const recaptchaSiteKeyHint = await fetchLoginPageCsrf(loginTimeoutMs)
        .then((preflight) => preflight.recaptchaSiteKey)
        .catch(() => undefined)

    let browser: Browser | undefined
    try {
        browser = await chromium.launch({ headless, chromiumSandbox })
        const context = await browser.newContext({ userAgent: PORTAL_BROWSER_USER_AGENT })
        const page = await context.newPage()
        attachOriginGuard(page)

        await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'load' })
        assertResellersOrigin(page.url())
        await page
            .waitForLoadState('networkidle', { timeout: loginTimeoutMs })
            .catch(() => undefined)

        if (isSpaSignInUrl(page.url())) {
            return await completeSpaHybridLogin(
                context,
                page,
                options,
                loginTimeoutMs,
                recaptchaSiteKeyHint,
            )
        }

        return await completeLegacyHybridLogin(
            context,
            page,
            options,
            loginTimeoutMs,
            recaptchaSiteKeyHint,
        )
    } finally {
        await browser?.close()
    }
}

/** @internal Exported for unit tests. */
export function isSpaSignInUrl(url: string): boolean {
    try {
        return new URL(url).pathname.startsWith('/auth/sign-in')
    } catch {
        return url.includes('/auth/sign-in')
    }
}

/** @internal Exported for unit tests. */
export function isPortalLoginPageUrl(url: string): boolean {
    try {
        const path = new URL(url).pathname
        return path.startsWith('/auth/sign-in') || path.startsWith('/accounts/login')
    } catch {
        return url.includes('/auth/sign-in') || url.includes('/accounts/login')
    }
}

async function completeSpaHybridLogin(
    context: BrowserContext,
    page: Page,
    options: PortalLoginOptions,
    loginTimeoutMs: number,
    recaptchaSiteKeyHint?: string,
): Promise<PortalLoginResult> {
    await page
        .locator('#email, input[name="email"]')
        .first()
        .waitFor({ state: 'visible', timeout: loginTimeoutMs })

    const csrfToken = (await context.cookies(PORTAL_ORIGIN)).find(
        (c) => c.name === 'csrftoken',
    )?.value
    if (!csrfToken) {
        throw new Error('Portal login preflight: missing csrftoken cookie on sign-in page.')
    }

    const priorSessionValues = await snapshotPortalSessionValues(context)

    const recaptchaToken = await obtainRecaptchaToken(page, loginTimeoutMs, recaptchaSiteKeyHint)
    if (!recaptchaToken) {
        throw new Error(
            'Portal login preflight: could not obtain reCAPTCHA token without submitting credentials. Set portalBrowserSubmitLogin only as a last resort.',
        )
    }

    const response = await context.request.post(PORTAL_V2_LOGIN_URL, {
        data: {
            username: options.username,
            password: options.password,
            rememberMe: false,
            captchaValue: recaptchaToken,
        },
        headers: {
            Referer: PORTAL_SIGN_IN_URL,
            'X-CSRFToken': csrfToken,
        },
        timeout: loginTimeoutMs,
    })

    if (response.status() !== 200) {
        const body = await response.text().catch(() => '')
        const portalMessage = parseLoginErrorFromBody(body)
        throw new Error(
            `Portal login failed with HTTP ${response.status()}. ${portalMessage ?? 'Check credentials or reCAPTCHA.'}`,
        )
    }

    return readPortalLoginResultFromContext(context, page, priorSessionValues)
}

async function completeLegacyHybridLogin(
    context: BrowserContext,
    page: Page,
    options: PortalLoginOptions,
    loginTimeoutMs: number,
    recaptchaSiteKeyHint?: string,
): Promise<PortalLoginResult> {
    const { csrfMiddlewareToken, csrfToken } = await resolveLoginCsrf(page, context, loginTimeoutMs)

    const priorSessionValues = await snapshotPortalSessionValues(context)

    const recaptchaToken = await obtainRecaptchaToken(page, loginTimeoutMs, recaptchaSiteKeyHint)
    if (!recaptchaToken) {
        throw new Error(
            'Portal login preflight: could not obtain reCAPTCHA token without submitting credentials. Set portalBrowserSubmitLogin only as a last resort.',
        )
    }

    const response = await context.request.post(PORTAL_LOGIN_URL, {
        form: {
            csrfmiddlewaretoken: csrfMiddlewareToken,
            username: options.username,
            password: options.password,
            recaptcha: recaptchaToken,
            this_is_the_login_form: '1',
        },
        headers: {
            Referer: PORTAL_LOGIN_URL,
            'X-CSRFToken': csrfToken,
        },
        maxRedirects: 0,
        timeout: loginTimeoutMs,
    })

    if (response.status() !== 302) {
        const body = await response.text().catch(() => '')
        const portalMessage = parseLoginErrorFromBody(body)
        throw new Error(
            `Portal login POST failed with HTTP ${response.status()}. ${portalMessage ?? 'Check credentials or reCAPTCHA.'}`,
        )
    }

    return readPortalLoginResultFromContext(context, page, priorSessionValues)
}

async function snapshotPortalSessionValues(
    context: BrowserContext,
): Promise<Record<string, string | undefined>> {
    const cookies = await context.cookies(PORTAL_ORIGIN)
    const values: Record<string, string | undefined> = {}
    for (const name of PORTAL_SESSION_COOKIE_NAMES) {
        values[name] = cookies.find((c) => c.name === name)?.value
    }
    return values
}

/** @internal Exported for unit tests. */
export function findPortalSessionCookieAfterLogin(
    cookies: { name: string; value: string }[],
    pageUrl: string,
    priorSessionValues: Record<string, string | undefined>,
): { name: string; value: string } | undefined {
    const onLoginPage = isPortalLoginPageUrl(pageUrl)
    const session = findPortalSessionCookie(cookies, onLoginPage)
    if (session?.value) {
        return session
    }
    if (!onLoginPage) {
        return undefined
    }
    for (const name of PORTAL_SESSION_COOKIE_NAMES) {
        if (name === 'pbapp3sess') {
            continue
        }
        const cookie = cookies.find((c) => c.name === name)
        if (!cookie?.value) {
            continue
        }
        const prior = priorSessionValues[name]
        if (prior !== undefined && prior !== cookie.value) {
            return cookie
        }
    }
    return undefined
}

async function readPortalLoginResultFromContext(
    context: BrowserContext,
    page: Page,
    priorSessionValues: Record<string, string | undefined>,
): Promise<PortalLoginResult> {
    const cookies = await context.cookies(PORTAL_ORIGIN)
    const session = findPortalSessionCookieAfterLogin(cookies, page.url(), priorSessionValues)
    const csrf = cookies.find((c) => c.name === 'csrftoken')

    if (!session?.value) {
        throw new Error(
            `Portal login POST succeeded but no session cookie was stored. cookies=${cookies.map((c) => c.name).join(', ')}`,
        )
    }
    if (!csrf?.value) {
        throw new Error('Portal login POST succeeded but csrftoken cookie is missing.')
    }

    return {
        authCookie: `${session.name}=${session.value}`,
        csrfToken: csrf.value,
    }
}

/** @internal Exported for unit tests. */
export function assertResellersOrigin(url: string): void {
    if (!url || url === 'about:blank') {
        return
    }
    let origin: string
    try {
        origin = new URL(url).origin
    } catch {
        throw new Error(`Portal login aborted: invalid URL ${url}`)
    }
    if (origin !== PORTAL_ORIGIN) {
        throw new Error(`Portal login aborted: unexpected origin ${origin}`)
    }
}

/** @internal Exported for unit tests. */
export function findPortalSessionCookie(
    cookies: { name: string; value: string }[],
    onLoginPage: boolean,
): { name: string; value: string } | undefined {
    const pbapp = cookies.find((c) => c.name === 'pbapp3sess')
    if (pbapp?.value) {
        return pbapp
    }

    if (onLoginPage) {
        return undefined
    }

    for (const name of PORTAL_SESSION_COOKIE_NAMES) {
        if (name === 'pbapp3sess') {
            continue
        }
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

/** @internal Exported for unit tests. */
export function parseCsrfFromLoginHtml(html: string): { csrfMiddlewareToken?: string } {
    const patterns = [
        /name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i,
        /value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i,
        /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i,
    ]
    for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) {
            return { csrfMiddlewareToken: match[1] }
        }
    }
    return {}
}

/** @internal Exported for unit tests. */
/** @internal Exported for unit tests. */
export function parseLoginErrorFromHtml(html: string): string | undefined {
    const match = html.match(/errorlist[^>]*>[\s\S]*?<li>([^<]+)<\/li>/i)
    return match?.[1]?.trim()
}

/** @internal Exported for unit tests. */
export function parseLoginErrorFromBody(body: string): string | undefined {
    const trimmed = body.trim()
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed) as { message?: string; code?: string }
            if (parsed.message) {
                return parsed.message
            }
            if (parsed.code) {
                return parsed.code
            }
        } catch {
            /* fall through to HTML parser */
        }
    }
    return parseLoginErrorFromHtml(body)
}

export function parseRecaptchaSiteKeyFromLoginHtml(html: string): string | undefined {
    const fromAttr = html.match(/data-sitekey=["']([^"']+)["']/i)?.[1]
    if (fromAttr) {
        return fromAttr
    }
    const fromRender = html.match(/recaptcha\/api\.js\?render=([^"'&\s]+)/i)?.[1]
    return fromRender
}

async function fetchLoginPageCsrf(
    loginTimeoutMs: number,
): Promise<{ csrfMiddlewareToken?: string; csrfToken: string; recaptchaSiteKey?: string }> {
    const jar = new CookieJar()
    const client = axios.create({
        baseURL: PORTAL_ORIGIN,
        timeout: loginTimeoutMs,
        httpAgent: new HttpCookieAgent({ cookies: { jar } }),
        httpsAgent: new HttpsCookieAgent({ cookies: { jar } }),
    })

    const { data } = await client.get<string>('/accounts/login/', {
        headers: { Accept: 'text/html' },
    })
    const html = String(data)
    const parsed = parseCsrfFromLoginHtml(html)
    const jarCookies = await jar.getCookies(PORTAL_ORIGIN)
    const csrfToken = jarCookies.find((c) => c.key === 'csrftoken')?.value
    if (!csrfToken) {
        throw new Error('Portal login preflight: GET login page did not return csrftoken cookie.')
    }
    return {
        csrfMiddlewareToken: parsed.csrfMiddlewareToken,
        csrfToken,
        recaptchaSiteKey: parseRecaptchaSiteKeyFromLoginHtml(html),
    }
}

/** @internal Exported for unit tests. */
export function mergeLoginCsrfFields(input: {
    csrfMiddlewareToken?: string
    csrfToken?: string
}): { csrfMiddlewareToken: string; csrfToken: string } | undefined {
    const csrfToken = input.csrfToken?.trim()
    let csrfMiddlewareToken = input.csrfMiddlewareToken?.trim()
    if (!csrfMiddlewareToken && csrfToken) {
        csrfMiddlewareToken = csrfToken
    }
    if (!csrfMiddlewareToken || !csrfToken) {
        return undefined
    }
    return { csrfMiddlewareToken, csrfToken }
}

async function resolveLoginCsrf(
    page: Page,
    context: BrowserContext,
    loginTimeoutMs: number,
): Promise<{ csrfMiddlewareToken: string; csrfToken: string }> {
    const loginForm = page.locator('#login-form')
    const formAttached = await loginForm
        .waitFor({ state: 'attached', timeout: loginTimeoutMs })
        .then(() => true)
        .catch(() => false)

    if (!formAttached) {
        throw new Error(
            `Portal login preflight: login form not found. url=${page.url()} title=${await page.title().catch(() => '(unknown)')}`,
        )
    }

    await loginForm
        .locator('input[name="username"], #id_username')
        .first()
        .waitFor({ state: 'visible', timeout: loginTimeoutMs })

    await loginForm
        .locator('input[name="csrfmiddlewaretoken"]')
        .first()
        .waitFor({ state: 'attached', timeout: loginTimeoutMs })
        .catch(() => undefined)

    let csrfMiddlewareToken = await readCsrfMiddlewareTokenFromPage(page)
    if (!csrfMiddlewareToken) {
        csrfMiddlewareToken = parseCsrfFromLoginHtml(await page.content()).csrfMiddlewareToken
    }

    const csrfCookie = (await context.cookies(PORTAL_ORIGIN)).find((c) => c.name === 'csrftoken')
    const merged = mergeLoginCsrfFields({
        csrfMiddlewareToken,
        csrfToken: csrfCookie?.value,
    })
    if (!merged) {
        throw new Error(
            `Portal login preflight: missing CSRF data. url=${page.url()} middleware=${Boolean(csrfMiddlewareToken)} csrftoken=${Boolean(csrfCookie?.value)}`,
        )
    }
    return merged
}

async function readCsrfMiddlewareTokenFromPage(page: Page): Promise<string | undefined> {
    const selectors = [
        '#login-form input[name="csrfmiddlewaretoken"]',
        'input[name="csrfmiddlewaretoken"]',
        '#csrfmiddlewaretoken',
        'input[name="csrf_token"]',
        'meta[name="csrf-token"]',
    ]
    for (const selector of selectors) {
        const locator = page.locator(selector).first()
        const count = await locator.count().catch(() => 0)
        if (count === 0) {
            continue
        }
        if (selector.startsWith('meta')) {
            const content = await locator.getAttribute('content')
            if (content) {
                return content
            }
        } else {
            const fromAttr = await locator.getAttribute('value').catch(() => null)
            if (fromAttr) {
                return fromAttr
            }
            const value = await locator.inputValue().catch(() => '')
            if (value) {
                return value
            }
        }
    }
    return undefined
}

async function obtainRecaptchaToken(
    page: Page,
    timeoutMs: number,
    siteKeyHint?: string,
): Promise<string> {
    const siteKey =
        siteKeyHint ?? (await resolveRecaptchaSiteKeyFromPage(page, Math.min(timeoutMs, 8000)))
    if (!siteKey) {
        return ''
    }

    await ensureRecaptchaApi(page, siteKey, timeoutMs)

    const executedToken =
        (await page
            .evaluate(async (key: string) => {
                const g = (
                    globalThis as unknown as {
                        grecaptcha?: {
                            execute: (k: string, o?: { action: string }) => Promise<string>
                        }
                    }
                ).grecaptcha
                if (!g?.execute) {
                    return ''
                }
                return g.execute(key, { action: 'login' })
            }, siteKey)
            .catch(() => '')) ?? ''
    const fromExecute = executedToken.trim()
    if (fromExecute) {
        const recaptchaInput = page.locator('input[name="recaptcha"], #id_recaptcha').first()
        await recaptchaInput
            .evaluate((el, token) => {
                ;(el as { value: string }).value = token
            }, fromExecute)
            .catch(() => undefined)
    }

    if (!fromExecute) {
        await page
            .waitForFunction(
                `const selectors = [
                'input[name="recaptcha"]',
                '#id_recaptcha',
                '#g-recaptcha-response',
                'textarea[name="g-recaptcha-response"]',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.value && el.value.length > 0) return true;
            }
            return false;`,
                undefined,
                { timeout: timeoutMs },
            )
            .catch(() => undefined)
    }

    const fromDom = (
        await page.locator(RECAPTCHA_TOKEN_SELECTORS).first().inputValue().catch(() => '')
    ).trim()
    return fromDom || fromExecute
}

async function resolveRecaptchaSiteKeyFromPage(
    page: Page,
    timeoutMs: number,
): Promise<string | undefined> {
    const locatorTimeout = Math.min(5000, timeoutMs)
    for (const selector of ['[data-sitekey]', '#id_recaptcha', 'input.g-recaptcha']) {
        const key = await page
            .locator(selector)
            .first()
            .getAttribute('data-sitekey', { timeout: locatorTimeout })
            .catch(() => null)
        if (key) {
            return key
        }
    }
    const fromDom = await page
        .evaluate<string | undefined>(
            `(() => {
            const el = document.querySelector('[data-sitekey]');
            const fromEl = el && el.getAttribute('data-sitekey');
            if (fromEl) return fromEl;
            for (const script of document.querySelectorAll('script[src*="recaptcha"]')) {
                const src = script.getAttribute('src') || '';
                const match = src.match(/[?&]render=([^&]+)/);
                if (match && match[1]) return match[1];
            }
            return undefined;
        })()`,
        )
        .catch(() => undefined)
    return fromDom
}

async function ensureRecaptchaApi(page: Page, siteKey: string, timeoutMs: number): Promise<void> {
    await waitForRecaptchaReady(page, Math.min(15_000, timeoutMs))
    const ready = await page
        .evaluate(
            () =>
                typeof (
                    globalThis as unknown as {
                        grecaptcha?: { execute?: unknown }
                    }
                ).grecaptcha?.execute === 'function',
        )
        .catch(() => false)
    if (ready) {
        return
    }
    await page
        .addScriptTag({
            url: `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`,
        })
        .catch(() => undefined)
    await waitForRecaptchaReady(page, timeoutMs)
}

/**
 * @deprecated Types credentials into the live portal document. Prefer default hybrid login.
 */
async function loginViaBrowserSubmit(options: PortalLoginOptions): Promise<PortalLoginResult> {
    const headless = options.headless ?? true
    const loginTimeoutMs = options.loginTimeoutMs ?? 60_000
    const chromiumSandbox = options.portalChromiumSandbox ?? true

    let browser: Browser | undefined
    try {
        browser = await chromium.launch({ headless, chromiumSandbox })
        const context = await browser.newContext({ userAgent: PORTAL_BROWSER_USER_AGENT })
        const page = await context.newPage()
        attachOriginGuard(page)

        await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'load' })
        assertResellersOrigin(page.url())
        await page
            .waitForLoadState('networkidle', { timeout: loginTimeoutMs })
            .catch(() => undefined)

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

        const spaSignIn = isSpaSignInUrl(page.url())
        const loginPost = page.waitForResponse(
            (response) =>
                response.request().method() === 'POST' &&
                (spaSignIn
                    ? response.url().includes('/v2/accounts/login')
                    : response.url().includes('/accounts/login')),
            { timeout: loginTimeoutMs },
        )

        if (spaSignIn) {
            await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        } else {
            await page
                .locator(
                    'button[type="submit"], input[type="submit"], button[name="login"], #login-button',
                )
                .first()
                .click()
        }

        const response = await loginPost.catch(() => undefined)
        if (response) {
            const expectedStatus = spaSignIn ? 200 : 302
            if (response.status() !== expectedStatus) {
                const body = await response.text().catch(() => '')
                const portalMessage = parseLoginErrorFromBody(body)
                throw new Error(
                    `Portal login POST failed with HTTP ${response.status()}. ${portalMessage ?? 'Check credentials or reCAPTCHA.'}`,
                )
            }
        }

        await page.waitForLoadState('networkidle', { timeout: loginTimeoutMs }).catch(() => {})

        const session = await pollForSessionCookie(context, page, loginTimeoutMs)
        const csrf = (await context.cookies(PORTAL_ORIGIN)).find((c) => c.name === 'csrftoken')

        if (!session?.value) {
            const url = page.url()
            const cookieNames =
                (await context.cookies(PORTAL_ORIGIN)).map((c) => c.name).join(', ') || '(none)'
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

function attachOriginGuard(page: Page): void {
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            assertResellersOrigin(frame.url())
        }
    })
}

async function pollForSessionCookie(
    context: BrowserContext,
    page: Page,
    timeoutMs: number,
): Promise<{ name: string; value: string } | undefined> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const cookies = await context.cookies(PORTAL_ORIGIN)
        const onLoginPage =
            page.url().includes('/accounts/login') || page.url().includes('/auth/sign-in')
        const session = findPortalSessionCookie(cookies, onLoginPage)
        if (session?.value) {
            return session
        }
        await sleep(250)
    }
    return undefined
}

async function readLoginErrorText(page: Page): Promise<string | undefined> {
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

async function waitForRecaptchaReady(page: Page, timeoutMs: number): Promise<void> {
    await page
        .waitForFunction(
            "typeof grecaptcha !== 'undefined' && typeof grecaptcha.execute === 'function'",
            undefined,
            { timeout: timeoutMs },
        )
        .catch(() => {
            /* Some builds load recaptcha only on submit; continue. */
        })
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
