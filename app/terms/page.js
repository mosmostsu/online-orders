import { BUSINESS, SITE, CONTACT_EMAIL, UPDATED } from '../legal';

export const metadata = { title: 'Terms of Service — order-sync' };

export default function Terms() {
  return (
    <div className="legal">
      <h1>Terms of Service</h1>
      <div className="sub">Last updated: {UPDATED}</div>

      <p>
        The web app at {SITE} (the &ldquo;App&rdquo;) is an internal tool operated by {BUSINESS} for managing our own shop&rsquo;s orders and content.
        By connecting a TikTok account or using the App you agree to these terms.
      </p>

      <h2>Who may use the App</h2>
      <p>The App is for authorized members of our team. Only the owner of a TikTok account may connect that account, and only after approving the permissions shown on TikTok&rsquo;s authorization screen.</p>

      <h2>What the App does</h2>
      <p>With the owner&rsquo;s permission the App reads the account&rsquo;s public videos and basic profile information and displays them to our team. It does not post, edit or delete content on TikTok.</p>

      <h2>Your control</h2>
      <p>You can revoke the App&rsquo;s access at any time from your TikTok settings or by contacting us. See our <a href="/privacy">Privacy Policy</a> for how data is handled and deleted.</p>

      <h2>Acceptable use</h2>
      <p>You agree not to misuse the App, attempt to access data you are not authorized to see, or use it in violation of TikTok&rsquo;s terms or applicable law.</p>

      <h2>Availability and liability</h2>
      <p>The App is provided &ldquo;as is&rdquo; without warranties. We may change or stop the App at any time, and are not liable for losses arising from its use, to the extent permitted by law.</p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the date above shows the latest version.{' '}
        {CONTACT_EMAIL ? <>Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></> : null}
      </p>
    </div>
  );
}
