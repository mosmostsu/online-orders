import { BUSINESS, SITE, CONTACT_EMAIL, UPDATED } from '../legal';

export const metadata = { title: 'Privacy Policy — order-sync' };

export default function Privacy() {
  return (
    <div className="legal">
      <h1>Privacy Policy</h1>
      <div className="sub">Last updated: {UPDATED}</div>

      <p>
        This policy explains how the web app at {SITE} (the &ldquo;App&rdquo;), operated by {BUSINESS}{' '}
        (&ldquo;we&rdquo;), handles data. The App is an internal dashboard for our own shop team. It is not offered to the general public.
      </p>

      <h2>What we collect</h2>
      <p>When the owner of a TikTok account connects that account to the App using TikTok Login Kit, and approves the requested permissions, we receive:</p>
      <ul>
        <li><b>user.info.basic</b>: the account&rsquo;s open ID, display name and avatar, used only to show which account is connected.</li>
        <li><b>video.list</b>: the account&rsquo;s public videos (video ID, description, posting date, link, and view, like, comment and share counts), used to show when videos were posted.</li>
        <li>An access token and refresh token issued by TikTok for that account.</li>
      </ul>
      <p>We only read data from accounts whose owner has authorized the App. We do not post, edit or delete videos, and we do not collect data about other TikTok users or viewers.</p>

      <h2>How we use it</h2>
      <p>The data is shown only to our own team inside the App (a table and calendar of our videos and posting dates). We do not sell it, share it with third parties, use it for advertising, or use it to train AI models.</p>

      <h2>Storage and security</h2>
      <p>Tokens and video data are stored on the App&rsquo;s server-side database and are never sent to the browser. Access to the database is limited to the App&rsquo;s server.</p>

      <h2>Retention, disconnecting and deletion</h2>
      <p>
        We keep the data while an account stays connected. You can disconnect at any time by removing the App in TikTok (Settings and privacy &rarr; Security and permissions &rarr; Apps and services),
        or by contacting us. On disconnection or request we delete the stored tokens and the video data we hold for that account.
      </p>

      <h2>Contact</h2>
      <p>{CONTACT_EMAIL ? <>Questions or deletion requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></> : 'Contact details are provided to authorized account owners directly.'}</p>
    </div>
  );
}
