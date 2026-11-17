import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AppShell from './layout';
import { BRAND_NAME, CONTACT_EMAIL } from './brand';
import { useI18n } from './i18n';
import {
    AlertCircle, Lightbulb, Target, Eye, Users, Trash2, Trophy, Mail, Phone, MapPin, ArrowRight, Leaf, CheckCircle2, XCircle,
} from 'lucide-react';
import useImpactStats from './useImpactStats';
import { formatCo2, formatCount, formatInr, formatKg } from './format';

export default function About() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();

    // Support deep links like /about#contact (e.g. from "Forgot password").
    React.useEffect(() => {
        if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    }, [location.hash]);

    const [isSending, setIsSending] = React.useState(false);
    const [formNotice, setFormNotice] = React.useState(null); // { type: 'success' | 'error', text }
    const { status: statsStatus, stats } = useImpactStats();
    const show = (fn) => (statsStatus === 'ready' ? fn(stats) : statsStatus === 'loading' ? '…' : '—');

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        setIsSending(true);
        setFormNotice(null);
        const formData = new FormData(e.target);
        formData.append('access_key', '4057803a-c08b-4527-884b-b79a200618b6');
        try {
            const res = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(Object.fromEntries(formData)),
            });
            const data = await res.json();
            if (data.success) {
                setFormNotice({ type: 'success', text: t('Message sent. We will get back to you soon.') });
                e.target.reset();
            } else {
                setFormNotice({ type: 'error', text: t('Your message could not be sent. Please try again.') });
            }
        } catch {
            setFormNotice({ type: 'error', text: t('Your message could not be sent. Check your internet connection and try again.') });
        } finally {
            setIsSending(false);
        }
    };

    const field = 'w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition bg-slate-50';

    return (
        <AppShell>
        <div className="pb-16">
            <div className="bg-gradient-to-br from-green-600 to-emerald-800 text-white py-16 sm:py-20 px-4 text-center rounded-b-[2rem] sm:rounded-b-[3rem] shadow-xl relative">
                <div className="max-w-3xl mx-auto">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold mb-6 tracking-tight">{t('Revolutionizing waste management')}</h1>
                    <p className="text-lg md:text-xl text-green-50 leading-relaxed opacity-90">
                        {t('{brand} is an AI-powered platform that transforms how campuses and cities handle waste. By combining machine learning with a rewarding incentive system, we make recycling not just a responsibility, but a rewarding habit.', { brand: BRAND_NAME })}
                    </p>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 mt-12 space-y-16">
                <div className="grid md:grid-cols-2 gap-8">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-red-100 hover:shadow-md transition">
                        <div className="bg-red-100 w-14 h-14 rounded-xl flex items-center justify-center mb-6"><AlertCircle className="text-red-500 w-7 h-7" /></div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-3">{t('The problem')}</h3>
                        <p className="text-slate-600 leading-relaxed">
                            {t('Every day, tons of recyclable waste end up in landfills simply because it is not segregated at the source. Ordinary bins offer no guidance or motivation, so dry, wet and sanitary waste get mixed and cannot be recycled.')}
                        </p>
                    </div>
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-emerald-100 hover:shadow-md transition">
                        <div className="bg-emerald-100 w-14 h-14 rounded-xl flex items-center justify-center mb-6"><Lightbulb className="text-emerald-600 w-7 h-7" /></div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-3">{t('Our solution')}</h3>
                        <p className="text-slate-600 leading-relaxed">
                            {t('Every {brand} bin carries a secure QR code. Users scan it at the bin, show their item to the phone camera, and our AI identifies it as Plastic, Metal, Paper / Cardboard, Glass, Organic or Other Trash, then tells them which BBMP stream and bin it belongs in. Each correctly sorted item earns campus credits.', { brand: BRAND_NAME })}
                        </p>
                    </div>
                </div>

                <div className="bg-emerald-900 rounded-3xl p-8 md:p-12 text-white shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-700 rounded-full blur-3xl opacity-30 -mr-20 -mt-20"></div>
                    <div className="grid md:grid-cols-2 gap-12 relative z-10">
                        <div>
                            <h3 className="text-2xl font-bold mb-4 flex items-center gap-3"><Target className="text-emerald-400" /> {t('Our mission')}</h3>
                            <p className="text-emerald-50 leading-relaxed">
                                {t('To automate and gamify waste segregation at the grassroots level. We educate communities through immediate AI feedback and reward green behaviour to build a zero-waste campus.')}
                            </p>
                        </div>
                        <div>
                            <h3 className="text-2xl font-bold mb-4 flex items-center gap-3"><Eye className="text-emerald-400" /> {t('Our vision')}</h3>
                            <p className="text-emerald-50 leading-relaxed">
                                {t('A world where technology bridges the gap between convenience and sustainability. We envision {brand} in every college, tech park and public space across the country.', { brand: BRAND_NAME })}
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <h2 className="text-center text-3xl font-bold text-slate-800 mb-2">{t('Our impact so far')}</h2>
                    <p className="text-center text-sm text-slate-500 mb-10">
                        {statsStatus === 'error'
                            ? t('Live figures are unavailable right now.')
                            : t('Live figures from the platform. Weight uses the bin\'s scale where available; CO₂ is an estimate per material.')}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[
                            { icon: <Users className="text-blue-500 w-10 h-10" />, value: show((s) => formatCount(s.users)), label: t('Eco-warriors') },
                            { icon: <Trash2 className="text-emerald-500 w-10 h-10" />, value: show((s) => formatCount(s.items)), label: t('Items recycled'), note: show((s) => t('~{kg} diverted', { kg: formatKg(s.wasteKg) })) },
                            { icon: <Leaf className="text-green-600 w-10 h-10" />, value: show((s) => formatCo2(s.co2Kg)), label: t('CO₂ saved (est.)') },
                            { icon: <Trophy className="text-yellow-500 w-10 h-10" />, value: show((s) => formatInr(s.rewardsIssued)), label: t('Rewards earned') },
                        ].map((c) => (
                            <div key={c.label} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 text-center">
                                <div className="flex justify-center mb-4">{c.icon}</div>
                                <h4 className="text-3xl md:text-4xl font-extrabold text-slate-800 mb-2">{c.value}</h4>
                                <p className="text-slate-500 font-medium uppercase tracking-wide text-sm">{c.label}</p>
                                {c.note && <p className="text-xs text-slate-400 mt-1">{c.note}</p>}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="text-center pb-12 border-b border-slate-200">
                    <h2 className="text-2xl font-bold text-slate-800 mb-6">{t('Ready to make a difference?')}</h2>
                    <button
                        onClick={() => navigate('/register')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-10 rounded-full shadow-lg transition transform hover:-translate-y-1 hover:shadow-emerald-500/30 flex items-center gap-2 mx-auto"
                    >
                        {t('Join the movement')} <ArrowRight size={20} />
                    </button>
                </div>
            </div>

            <div id="contact" className="max-w-5xl mx-auto px-4 mt-16 scroll-mt-8">
                <h2 className="text-3xl font-bold text-center text-slate-800 mb-12">{t('Get in touch')}</h2>
                <div className="grid md:grid-cols-5 md:gap-8 bg-white rounded-3xl shadow-lg overflow-hidden border border-slate-100">
                    <div className="md:col-span-2 bg-slate-900 text-white p-6 sm:p-10 flex flex-col justify-between">
                        <div>
                            <h3 className="text-2xl font-bold mb-2">{t('Contact information')}</h3>
                            <p className="text-slate-300 mb-8">{t('Reach out to us for college deployments, partnerships, or support queries.')}</p>
                            <div className="space-y-6">
                                <div className="flex items-start gap-4">
                                    <MapPin className="text-emerald-400 mt-1" size={24} />
                                    <div>
                                        <h4 className="font-semibold text-white">{t('Our location')}</h4>
                                        <p className="text-slate-300 text-sm">Dr. Ambedkar Institute of Technology<br />{t('Bengaluru, Karnataka')}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <Phone className="text-emerald-400 mt-1" size={24} />
                                    <div>
                                        <h4 className="font-semibold text-white">{t('Phone')}</h4>
                                        <a href="tel:+918310398093" className="text-slate-300 text-sm hover:text-white underline-offset-2 hover:underline">+91 83103 98093</a>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <Mail className="text-emerald-400 mt-1" size={24} />
                                    <div>
                                        <h4 className="font-semibold text-white">{t('Email')}</h4>
                                        <a href={`mailto:${CONTACT_EMAIL}`} className="text-slate-300 text-sm hover:text-white underline-offset-2 hover:underline break-all">{CONTACT_EMAIL}</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-12"><div className="w-16 h-1 bg-emerald-500 rounded-full"></div></div>
                    </div>

                    <div className="md:col-span-3 p-6 sm:p-10">
                        <form onSubmit={handleFormSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="contact-first" className="block text-sm font-medium text-slate-700 mb-1">{t('First name')}</label>
                                    <input id="contact-first" type="text" name="First Name" autoComplete="given-name" required className={field} disabled={isSending} />
                                </div>
                                <div>
                                    <label htmlFor="contact-last" className="block text-sm font-medium text-slate-700 mb-1">{t('Last name')}</label>
                                    <input id="contact-last" type="text" name="Last Name" autoComplete="family-name" required className={field} disabled={isSending} />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700 mb-1">{t('Email address')}</label>
                                <input id="contact-email" type="email" name="Email" autoComplete="email" required className={field} placeholder="name@example.com" disabled={isSending} />
                            </div>
                            <div>
                                <label htmlFor="contact-message" className="block text-sm font-medium text-slate-700 mb-1">{t('Message')}</label>
                                <textarea id="contact-message" name="Message" required rows="4" className={`${field} resize-none`} placeholder={t('How can we help you?')} disabled={isSending}></textarea>
                            </div>
                            {formNotice && (
                                <p role={formNotice.type === 'error' ? 'alert' : 'status'}
                                    className={`flex items-start gap-2 text-sm rounded-xl p-3 ${formNotice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
                                    {formNotice.type === 'error'
                                        ? <XCircle size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                                        : <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />}
                                    {formNotice.text}
                                </p>
                            )}
                            <button
                                type="submit"
                                disabled={isSending}
                                className={`font-bold py-3 px-8 rounded-xl transition w-full md:w-auto flex items-center justify-center gap-2 text-white ${isSending ? 'bg-emerald-600/60 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                            >
                                {isSending ? t('Sending…') : t('Send message')}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
        </AppShell>
    );
}
