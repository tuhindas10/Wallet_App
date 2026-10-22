import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:3001/api';
const PIN = '4821';

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function makeUser(label) {
    const username = `${label}_${Math.random().toString(36).slice(2, 8)}`;
    const signup = await api('/auth/signup', {
        method: 'POST',
        body: {
            username,
            name: label,
            email: `${username}@test.com`,
            password: 'Wallet123',
        },
    });
    if (signup.status !== 201) {
        throw new Error(`Signup failed: ${JSON.stringify(signup.data)}`);
    }
    const token = signup.data.accessToken;
    const pin = await api('/users/me/pin', { method: 'POST', token, body: { pin: PIN } });
    if (pin.status >= 300) throw new Error(`PIN failed: ${JSON.stringify(pin.data)}`);
    return { username, token };
}

const balanceOf = async (u) =>
    (await api('/wallet', { token: u.token })).data.balancePaise;

const send = (from, to, amountPaise, key = randomUUID()) =>
    api('/transactions/send', {
        method: 'POST',
        token: from.token,
        headers: { 'Idempotency-Key': key },
        body: { recipientUsername: to.username, amountPaise, pin: PIN },
    });

const count = (results, status) =>
    results.filter((r) => r.data.status === status).length;

let failures = 0;
function check(label, ok) {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

async function overspend() {
    console.log('\nTest 1: 20 parallel payments of ₹100 from a ₹1000 wallet');
    const a = await makeUser('alice');
    const b = await makeUser('bob');
    const results = await Promise.all(
        Array.from({ length: 20 }, () => send(a, b, 10_000)),
    );
    const [balA, balB] = [await balanceOf(a), await balanceOf(b)];
    console.log(`  success=${count(results, 'SUCCESS')} failed=${count(results, 'FAILED')} alice=${balA} bob=${balB}`);
    check('no server errors', results.every((r) => r.status < 500));
    check('exactly 10 payments succeeded', count(results, 'SUCCESS') === 10);
    check('exactly 10 payments failed cleanly', count(results, 'FAILED') === 10);
    check('alice is at 0, never negative', balA === 0);
    check('total money unchanged', balA + balB === 200_000);
}

async function sameKey() {
    console.log('\nTest 2: 10 parallel requests with the SAME idempotency key');
    const a = await makeUser('carol');
    const b = await makeUser('dave');
    const key = randomUUID();
    const results = await Promise.all(
        Array.from({ length: 10 }, () => send(a, b, 10_000, key)),
    );
    const ids = new Set(results.map((r) => r.data.transactionId));
    const [balA, balB] = [await balanceOf(a), await balanceOf(b)];
    console.log(`  distinct transactions=${ids.size} carol=${balA} dave=${balB}`);
    check('all responses point to ONE transaction', ids.size === 1 && !ids.has(undefined));
    check('carol was charged exactly once', balA === 90_000);
    check('dave was credited exactly once', balB === 110_000);
}

async function crossPayments() {
    console.log('\nTest 3: 20 payments each way at the same time (deadlock check)');
    const a = await makeUser('erin');
    const b = await makeUser('frank');
    const jobs = [];
    for (let i = 0; i < 20; i++) {
        jobs.push(send(a, b, 1_000));
        jobs.push(send(b, a, 1_000));
    }
    const results = await Promise.all(jobs);
    const [balA, balB] = [await balanceOf(a), await balanceOf(b)];
    console.log(`  success=${count(results, 'SUCCESS')} erin=${balA} frank=${balB}`);
    check('no server errors or deadlocks', results.every((r) => r.status === 201));
    check('all 40 payments succeeded', count(results, 'SUCCESS') === 40);
    check('both balances back to ₹1000', balA === 100_000 && balB === 100_000);
}

await overspend();
await sameKey();
await crossPayments();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);