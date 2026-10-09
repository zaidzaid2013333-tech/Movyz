import React from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { SeoHead } from '../components/SEOHead';

export const LegalPage: React.FC = () => {
  const { language, direction } = useLanguage();

  return (
    <div className="min-h-screen bg-[#08090d] text-slate-200">
      <SeoHead
        title={language === 'ar' ? 'إخلاء المسؤولية وDMCA | موفيزا' : 'DMCA & Third-Party Policy | Movyza'}
        description={language === 'ar'
          ? 'سياسة موفيزا للمحتوى من الأطراف الثالثة وطلبات حقوق النشر والإبلاغ.'
          : 'Movyza policy for third-party embedded content, copyright notices, and DMCA requests.'}
      />

      <main dir={direction} className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="movyza-glass-panel rounded-3xl border border-white/[0.08] bg-[#0b0e14] p-6 sm:p-10 shadow-2xl">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300/80">MOVYZA</p>
              <h1 className="mt-1 text-2xl sm:text-3xl font-black text-white">
                {language === 'ar' ? 'إخلاء المسؤولية وDMCA' : 'DMCA & Third-Party Content Policy'}
              </h1>
              <p className="mt-2 text-xs text-slate-500">Last updated: October 7, 2026</p>
            </div>
          </div>

          <div dir="ltr" className="mt-8 space-y-7 text-sm leading-7 text-slate-300">
            <section>
              <h2 className="text-lg font-bold text-white">1. Service Description</h2>
              <p className="mt-2">
                Movyza ("Movyza", "we", "us", or "our") operates as a search, discovery,
                indexing, and content-navigation platform. The service is designed to help
                users discover information about movies and television programs and, where
                available, access media through embedded third-party players.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white">2. Third-Party Content</h2>
              <p className="mt-2">
                Where media is delivered through a third-party embedded player, Movyza does
                not upload or store the underlying video files on its own application servers.
                The third-party provider controls its own hosting, streaming infrastructure,
                media URLs, availability, advertising, and technical operation.
              </p>
              <p className="mt-2">
                Copyright and other intellectual-property rights remain with their respective
                rights holders. Movyza does not claim ownership of third-party copyrighted material.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white">3. Third-Party Services</h2>
              <p className="mt-2">
                Movyza does not control and is not responsible for the content, availability,
                legality, security, accuracy, or policies of independent third-party websites,
                APIs, media providers, or embedded players. Third-party services may change,
                become unavailable, or remove material without notice.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white">4. Copyright and DMCA Notices</h2>
              <p className="mt-2">
                Copyright owners or authorized representatives who believe that material
                accessible through Movyza infringes their rights may contact:
              </p>
              <a
                href="mailto:sameranede@gmail.com"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 font-bold text-amber-200 hover:bg-amber-400/[0.10]"
              >
                <Mail className="w-4 h-4" />
                sameranede@gmail.com
              </a>
              <p className="mt-3">A notice should include:</p>
              <ol className="mt-2 list-decimal pl-5 space-y-1.5">
                <li>Identification of the copyrighted work or works allegedly infringed.</li>
                <li>The Movyza URL or embedded content associated with the complaint.</li>
                <li>Evidence of ownership or authorization to act for the rights holder.</li>
                <li>Accurate contact information.</li>
                <li>A good-faith statement that the information provided is accurate and that you are authorized to submit the notice.</li>
                <li>An electronic or physical signature.</li>
              </ol>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white">5. Review and Removal</h2>
              <p className="mt-2">
                Movyza will review sufficiently detailed copyright complaints and, where
                appropriate and technically possible, may disable, remove, or modify the
                relevant page, link, search result, or embedded reference.
              </p>
              <p className="mt-2">
                Our operational target is to review properly submitted notices within
                <strong className="text-white"> 48 hours</strong>. This is a target, not a
                guarantee of removal or resolution within that period.
              </p>
              <p className="mt-2">
                Because the underlying media may be hosted or delivered by an independent
                third party, removing a Movyza reference does not necessarily remove the
                underlying material from that third-party service. Rights holders may also
                need to contact the responsible third-party provider directly.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white">6. Counter-Notifications and Abuse</h2>
              <p className="mt-2">
                Where applicable, a person affected by a copyright removal request may submit
                a counter-notification containing information required by applicable law.
                False, fraudulent, or intentionally misleading complaints may be rejected.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white">7. Policy Updates</h2>
              <p className="mt-2">
                Movyza may update this policy to reflect changes to its services,
                infrastructure, third-party integrations, or applicable law.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};
