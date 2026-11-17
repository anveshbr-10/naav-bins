const test = require('node:test');
const assert = require('node:assert/strict');
const { checkEmail, suggestDomain } = require('../lib/emailCheck');

const err = code => Object.assign(new Error(code), { code });
const resolver = {
    resolveMx: async d => {
        if (d === 'college.edu.in') return [{ exchange: 'mx.college.edu.in', priority: 10 }];
        if (d === 'nomail.org') return [{ exchange: '.', priority: 0 }];
        if (d === 'flaky.org') throw err('ESERVFAIL');
        throw err('ENOTFOUND');
    },
    resolve4: async () => { throw err('ENOTFOUND'); },
};

test('email check: format, typos, disposable and domains that cannot receive mail', async () => {
    assert.deepEqual(await checkEmail('student@gmail.com', { resolver }), { ok: true });
    assert.deepEqual(await checkEmail('a@college.edu.in', { resolver }), { ok: true });
    assert.equal((await checkEmail('not-an-email', { resolver })).reason, 'format');
    assert.equal((await checkEmail('a..b@gmail.com', { resolver })).reason, 'format');
    assert.deepEqual(await checkEmail('ravi@gmial.com', { resolver }), { ok: false, reason: 'typo', suggestion: 'ravi@gmail.com' });
    assert.equal((await checkEmail('x@mailinator.com', { resolver })).reason, 'disposable');
    assert.equal((await checkEmail('x@asdfqwerzz.com', { resolver })).reason, 'no_mail');
    assert.equal((await checkEmail('x@nomail.org', { resolver })).reason, 'no_mail');
    assert.deepEqual(await checkEmail('x@flaky.org', { resolver }), { ok: true }, 'DNS failure never blocks sign-up');
});

test('email check: domain suggestions', () => {
    assert.equal(suggestDomain('gmail.co'), 'gmail.com');
    assert.equal(suggestDomain('yaho.com'), 'yahoo.com');
    assert.equal(suggestDomain('gmail.com'), null);
    assert.equal(suggestDomain('dr-ait.org'), null);
});
