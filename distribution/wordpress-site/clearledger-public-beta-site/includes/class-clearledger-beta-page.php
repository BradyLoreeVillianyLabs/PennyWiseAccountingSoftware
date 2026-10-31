<?php
/**
 * Public ClearLedger beta landing-page shortcode.
 *
 * @package ClearLedger_Public_Beta_Site
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ClearLedger_Beta_Page {
	/**
	 * Register hooks.
	 */
	public static function init() {
		add_shortcode( 'clearledger_beta', array( __CLASS__, 'render' ) );
		add_shortcode( 'clearledger_support', array( __CLASS__, 'render_support' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
	}

	/**
	 * Load assets only when a singular page contains the shortcode.
	 */
	public static function enqueue_assets() {
		global $post;

		$has_landing = $post instanceof WP_Post && has_shortcode( $post->post_content, 'clearledger_beta' );
		$has_support = $post instanceof WP_Post && has_shortcode( $post->post_content, 'clearledger_support' );
		$has_community = $post instanceof WP_Post && has_shortcode( $post->post_content, 'clearledger_community' );

		if ( ! is_singular() || ( ! $has_landing && ! $has_support && ! $has_community ) ) {
			return;
		}

		wp_enqueue_style(
			'clearledger-public-beta-site',
			CLEARLEDGER_BETA_SITE_URL . 'assets/css/public-beta.css',
			array(),
			CLEARLEDGER_BETA_SITE_VERSION
		);

		wp_enqueue_script(
			'clearledger-public-beta-site',
			CLEARLEDGER_BETA_SITE_URL . 'assets/js/public-beta.js',
			array(),
			CLEARLEDGER_BETA_SITE_VERSION,
			true
		);
	}

	/**
	 * Render the complete public-beta page.
	 *
	 * @return string
	 */
	public static function render() {
		$options        = ClearLedger_Beta_Settings::get_options();
		$download_ready = self::download_is_ready( $options );
		$installation   = $options['installation_url'] ? $options['installation_url'] : '#clearledger-install';
		$limitations    = $options['limitations_url'] ? $options['limitations_url'] : '#clearledger-beta-safety';
		$privacy        = $options['privacy_url'] ? $options['privacy_url'] : '#clearledger-privacy';
		$support        = home_url( '/clearledger-support/' );
		$community      = home_url( '/clearledger-community/' );
		$founder_checkout = $options['founder_checkout_url'];
		$founder_terms    = $options['founder_terms_url'];

		ob_start();
		?>
		<div class="cl-beta-site" data-cl-beta-site>
			<a class="cl-skip-link" href="#clearledger-main"><?php echo esc_html__( 'Skip to PennyWise Accounting overview', 'clearledger-public-beta-site' ); ?></a>

			<header class="cl-site-header" aria-label="<?php echo esc_attr__( 'PennyWise Accounting', 'clearledger-public-beta-site' ); ?>">
				<div class="cl-page-width cl-header-inner">
					<a class="cl-wordmark" href="#clearledger-main" aria-label="<?php echo esc_attr__( 'PennyWise Accounting overview', 'clearledger-public-beta-site' ); ?>">PennyWise <span>Accounting</span></a>
					<nav class="cl-nav" aria-label="<?php echo esc_attr__( 'On this page', 'clearledger-public-beta-site' ); ?>">
						<a href="#clearledger-migration"><?php echo esc_html__( 'Move your books', 'clearledger-public-beta-site' ); ?></a>
						<a href="#clearledger-capability-index"><?php echo esc_html__( 'What it does', 'clearledger-public-beta-site' ); ?></a>
						<a href="#clearledger-founder-offer"><?php echo esc_html__( 'C$99 Founder offer', 'clearledger-public-beta-site' ); ?></a>
					</nav>
					<a class="cl-button cl-button-small" href="#clearledger-download"><?php echo esc_html__( 'Start free', 'clearledger-public-beta-site' ); ?></a>
				</div>
			</header>

			<div id="clearledger-main">
				<section class="cl-hero" id="clearledger-overview" aria-labelledby="clearledger-hero-title">
					<div class="cl-page-width cl-hero-grid">
						<div class="cl-hero-copy">
							<h1 id="clearledger-hero-title"><?php echo esc_html__( 'Know what needs attention. Keep every number explainable.', 'clearledger-public-beta-site' ); ?></h1>
							<p class="cl-hero-summary"><?php echo esc_html__( 'PennyWise Accounting brings invoicing, bills, reconciliation, inventory, projects, CAD/USD books, and review-first commerce evidence into one focused workspace for Canadian small businesses.', 'clearledger-public-beta-site' ); ?></p>
							<div class="cl-actions">
								<a class="cl-button" href="#clearledger-download"><?php echo esc_html__( 'Start 30 days free', 'clearledger-public-beta-site' ); ?></a>
								<a class="cl-button cl-button-secondary" href="#clearledger-migration"><?php echo esc_html__( 'See how migration works', 'clearledger-public-beta-site' ); ?></a>
							</div>
							<ul class="cl-trust-line" aria-label="<?php echo esc_attr__( 'Release characteristics', 'clearledger-public-beta-site' ); ?>">
								<li><?php echo self::icon( 'maple' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><?php echo esc_html__( 'Local-first Windows beta', 'clearledger-public-beta-site' ); ?></li>
								<li><?php echo esc_html__( 'CAD and USD', 'clearledger-public-beta-site' ); ?></li>
								<li><?php echo esc_html__( 'First 1,000: C$99 once', 'clearledger-public-beta-site' ); ?></li>
								<li><?php echo esc_html__( 'Exportable records', 'clearledger-public-beta-site' ); ?></li>
							</ul>
						</div>

						<div class="cl-hero-product">
							<?php if ( $options['screenshot_dashboard_url'] ) : ?>
								<figure class="cl-release-shot cl-release-shot-hero">
					<img src="<?php echo esc_url( $options['screenshot_dashboard_url'] ); ?>" alt="<?php echo esc_attr( $options['screenshot_dashboard_alt'] ); ?>" decoding="async" fetchpriority="high" referrerpolicy="no-referrer">
									<figcaption><?php echo esc_html__( 'Public-beta release screenshot.', 'clearledger-public-beta-site' ); ?></figcaption>
								</figure>
							<?php else : ?>
								<?php self::render_illustrative_preview(); ?>
							<?php endif; ?>
						</div>
					</div>
				</section>

				<section class="cl-migration" id="clearledger-migration" aria-labelledby="clearledger-migration-title">
					<div class="cl-page-width">
						<h2 id="clearledger-migration-title"><?php echo esc_html__( 'Move without losing the trail.', 'clearledger-public-beta-site' ); ?></h2>
						<ol class="cl-step-rail">
							<li>
								<span class="cl-step-number" aria-hidden="true">01</span>
								<div><?php echo self::icon( 'export' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
								<div><h3><?php echo esc_html__( 'Export from your current system', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Keep a complete source archive, then bring standard CSV or Excel exports into a staged preview.', 'clearledger-public-beta-site' ); ?></p></div>
							</li>
							<li>
								<span class="cl-step-number" aria-hidden="true">02</span>
								<div><?php echo self::icon( 'map' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
								<div><h3><?php echo esc_html__( 'Map and review', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Match fields visually, keep leading zeros, resolve duplicates, and confirm the preview before import.', 'clearledger-public-beta-site' ); ?></p></div>
							</li>
							<li>
								<span class="cl-step-number" aria-hidden="true">03</span>
								<div><?php echo self::icon( 'verify' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
								<div><h3><?php echo esc_html__( 'Import and verify', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Reconcile opening balances, receivables, payables, tax, inventory, and foreign-currency controls before relying on the new books.', 'clearledger-public-beta-site' ); ?></p></div>
							</li>
						</ol>
					</div>
				</section>

				<section class="cl-capability-index" id="clearledger-capability-index" aria-labelledby="clearledger-capability-index-title">
					<div class="cl-page-width cl-section-heading">
						<p class="cl-section-kicker"><?php echo esc_html__( 'Searchable product guide', 'clearledger-public-beta-site' ); ?></p>
						<h2 id="clearledger-capability-index-title"><?php echo esc_html__( 'Find the workflow you need.', 'clearledger-public-beta-site' ); ?></h2>
						<p><?php echo esc_html__( 'Every search result is a link. The descriptions reflect the released beta boundary, not unsupported provider automation.', 'clearledger-public-beta-site' ); ?></p>
						<label class="cl-capability-search-label" for="clearledger-capability-search"><?php echo esc_html__( 'Find a capability', 'clearledger-public-beta-site' ); ?></label>
						<input id="clearledger-capability-search" class="cl-capability-search" type="search" placeholder="Try invoices, migration, inventory, tax, CRM, or reports" autocomplete="off" data-cl-capability-search>
						<p class="cl-capability-search-status" role="status" aria-live="polite" data-cl-capability-search-status></p>
					</div>
					<div class="cl-page-width cl-capability-grid" data-cl-capability-list>
						<a href="#clearledger-download" data-cl-capability-item><h3><?php echo esc_html__( 'Invoices, payments, and receivables', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Create polished CAD or USD invoices, review drafts, record payments, and keep receivables visible without editing posted history.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-download" data-cl-capability-item><h3><?php echo esc_html__( 'Bills, expenses, and payables', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Capture expenses and supplier bills, preserve evidence, track due dates, and stage bulk entry without silently posting rows.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-migration" data-cl-capability-item><h3><?php echo esc_html__( 'Switching Centre and spreadsheet migration', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Map and preview QuickBooks, CSV, or Excel exports, flag ambiguity, and reconcile before relying on imported books.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-download" data-cl-capability-item><h3><?php echo esc_html__( 'Inventory, reviewed SKU matching, and thumbnails', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Track items, quantities, costs, locations, and identifiers. Suggestions explain their evidence and require confirmation; an approved, ingested provider image can appear as a compact inventory thumbnail.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-beta-safety" data-cl-capability-item><h3><?php echo esc_html__( 'Tax Centre and CAD/USD controls', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Apply configured effective-dated tax codes with calculation evidence. PennyWise does not file or remit taxes, and it does not automatically decide what Etsy or another marketplace has remitted; marketplace evidence needs review and correct classification.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-beta-safety" data-cl-capability-item><h3><?php echo esc_html__( 'WooCommerce, Etsy, POS, and refunds', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Stage WooCommerce orders, refunds, and catalog evidence plus Etsy receipt, fee, payout, and catalog evidence for review. Creating a local item or ingesting an approved image is explicit; provider approval, marketplace tax-remittance decisions, and live ledger posting are not included.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-beta-safety" data-cl-capability-item><h3><?php echo esc_html__( 'Live services: bank feeds, payroll, direct deposit, and filing', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'The public beta does not offer live bank feeds or a released statutory payroll service. Direct deposit, CRA filing or remittance, ROE/T4 submission, and unsupported jurisdictional payroll remain unavailable.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-download" data-cl-capability-item><h3><?php echo esc_html__( 'CRM, calendar, projects, and planning', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Coordinate contacts, reminders, projects, milestones, and time without turning planning records into accounting entries.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-download" data-cl-capability-item><h3><?php echo esc_html__( 'Dashboard, workbench, and navigation', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Use a compact QuickBooks-familiar dashboard, global search, contextual lists, and movable desktop work surfaces.', 'clearledger-public-beta-site' ); ?></p></a>
						<a href="#clearledger-beta-safety" data-cl-capability-item><h3><?php echo esc_html__( 'Reconciliation, audit trail, and recovery', 'clearledger-public-beta-site' ); ?></h3><p><?php echo esc_html__( 'Review reconciliation evidence, preserve immutable posted history, export records, and keep explicit safety boundaries.', 'clearledger-public-beta-site' ); ?></p></a>
					</div>
				</section>

				<?php self::render_optional_screenshots( $options ); ?>

				<section class="cl-beta-program" id="clearledger-founder-offer" aria-labelledby="clearledger-founder-offer-title">
					<div class="cl-page-width">
						<div class="cl-section-heading">
							<p class="cl-section-kicker"><?php echo esc_html__( 'Founding release', 'clearledger-public-beta-site' ); ?></p>
							<h2 id="clearledger-founder-offer-title"><?php echo esc_html__( 'Use PennyWise free for 30 days. Then join the first 1,000 Founders for C$99 once.', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'No card is required for the trial and there is no automatic charge. If PennyWise fits your workflow, the Founders package is a one-time C$99 purchase with lifetime use of released PennyWise Accounting updates, subject to the founder licence terms.', 'clearledger-public-beta-site' ); ?></p>
						</div>
						<div class="cl-beta-program-grid">
							<article>
								<span class="cl-beta-program-kicker"><?php echo esc_html__( 'First 1,000 completed purchases', 'clearledger-public-beta-site' ); ?></span>
								<h3><?php echo esc_html__( 'C$99 one-time', 'clearledger-public-beta-site' ); ?></h3>
								<p><?php echo esc_html__( 'A founder purchase, not a monthly plan. Request founder enrolment through private support after downloading the beta.', 'clearledger-public-beta-site' ); ?></p>
							</article>
							<article>
								<span class="cl-beta-program-kicker"><?php echo esc_html__( 'Included for life', 'clearledger-public-beta-site' ); ?></span>
								<h3><?php echo esc_html__( 'Released PennyWise updates', 'clearledger-public-beta-site' ); ?></h3>
								<p><?php echo esc_html__( 'Founders keep lifetime use of released PennyWise Accounting updates without a recurring PennyWise subscription.', 'clearledger-public-beta-site' ); ?></p>
							</article>
							<article>
								<span class="cl-beta-program-kicker"><?php echo esc_html__( 'Best fit', 'clearledger-public-beta-site' ); ?></span>
								<h3><?php echo esc_html__( 'Bookkeepers, service firms, and commerce sellers', 'clearledger-public-beta-site' ); ?></h3>
								<p><?php echo esc_html__( 'Start with CAD/USD books, invoices, bills, bank reconciliation, spreadsheet migration, or WooCommerce/Etsy review. Live provider posting is not included.', 'clearledger-public-beta-site' ); ?></p>
							</article>
						</div>
						<div class="cl-beta-program-cta">
							<?php if ( $founder_checkout ) : ?>
								<p><strong><?php echo esc_html__( 'Founder checkout:', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'Payment is completed on Stripe’s hosted checkout. PennyWise never receives your card details. Founder access is fulfilled only after Stripe confirms a completed payment.', 'clearledger-public-beta-site' ); ?></p>
								<a class="cl-button" href="<?php echo esc_url( $founder_checkout ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html__( 'Continue to secure Stripe checkout', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
								<?php if ( $founder_terms ) : ?>
									<a class="cl-button cl-button-secondary" href="<?php echo esc_url( $founder_terms ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html__( 'Read founder terms', 'clearledger-public-beta-site' ); ?></a>
								<?php endif; ?>
							<?php else : ?>
								<p><strong><?php echo esc_html__( 'Claim founder access:', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'Download the beta, keep your download evidence, and use private support to request the founder enrolment path. Do not send credentials, payment details, or customer records.', 'clearledger-public-beta-site' ); ?></p>
								<a class="cl-button" href="<?php echo esc_url( $support ); ?>"><?php echo esc_html__( 'Request founder access', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
							<?php endif; ?>
						</div>
						<p class="cl-founder-terms"><?php echo esc_html__( 'Founder availability is limited to the first 1,000 completed Stripe purchases. Trial access lasts 30 days and does not reserve a Founder place. No recurring PennyWise payment is required. Review the final founder, refund, privacy, and beta terms before payment.', 'clearledger-public-beta-site' ); ?></p>
					</div>
				</section>

				<section class="cl-safety" id="clearledger-beta-safety" aria-labelledby="clearledger-safety-title">
					<div class="cl-page-width cl-safety-grid">
						<div>
							<h2 id="clearledger-safety-title"><?php echo esc_html__( 'A beta with clear boundaries.', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'This is development-stage software for informed testing, not a hosted filing, payroll, banking, or professional-advice service.', 'clearledger-public-beta-site' ); ?></p>
						</div>
						<ul class="cl-check-list">
							<li><?php echo self::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><span><?php echo esc_html__( 'Install locally on a supported computer you control. Do not expose the development API directly to the internet.', 'clearledger-public-beta-site' ); ?></span></li>
							<li><?php echo self::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><span><?php echo esc_html__( 'Back up regularly, complete a restore drill, and retain original documents plus a complete prior-system archive.', 'clearledger-public-beta-site' ); ?></span></li>
							<li><?php echo self::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><span><?php echo esc_html__( 'Export your organization regularly and reconcile every control balance at migration and close.', 'clearledger-public-beta-site' ); ?></span></li>
							<li><?php echo self::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><span><?php echo esc_html__( 'Posted records are immutable. Corrections use linked reversals, credits, refunds, voids, or adjustments.', 'clearledger-public-beta-site' ); ?></span></li>
							<li><?php echo self::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><span><?php echo esc_html__( 'Have filing, payroll, tax, inventory valuation, and financial-statement results reviewed by qualified professionals.', 'clearledger-public-beta-site' ); ?></span></li>
						</ul>
					</div>
					<div class="cl-page-width cl-limitations">
						<h3><?php echo esc_html__( 'Important public-beta limitations', 'clearledger-public-beta-site' ); ?></h3>
						<div class="cl-limitations-columns">
							<p><?php echo esc_html__( 'The local beta identity flow is not production internet identity. Live bank feeds are disabled. A native payroll foundation is under a separate gated release program; it is not a public-beta payroll service. Direct deposit, statutory filing or remittance, production OCR, hosted payments, email delivery, and mobile app-store packages require separate provider and release evidence.', 'clearledger-public-beta-site' ); ?></p>
							<p><?php echo esc_html__( 'WooCommerce and Etsy sites vary. Provider data enters a review or reconciliation boundary first. PennyWise does not automatically determine a marketplace tax-remittance responsibility. Treat any capability not named in the release manifest as unsupported, and stop if a result could affect a filing or balance.', 'clearledger-public-beta-site' ); ?></p>
						</div>
						<a class="cl-text-link" href="<?php echo esc_url( $limitations ); ?>"><?php echo esc_html__( 'Read the complete known limitations', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
					</div>
				</section>

				<section class="cl-download" id="clearledger-download" aria-labelledby="clearledger-download-title">
					<div class="cl-page-width cl-download-panel">
						<div class="cl-download-copy">
							<h2 id="clearledger-download-title"><?php echo esc_html__( 'Verify every installer.', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'The checksum proves that the Windows installer you received matches the installer published here. It does not replace backups, malware protection, or professional review.', 'clearledger-public-beta-site' ); ?></p>
							<p class="cl-beta-notice"><strong><?php echo esc_html__( '30-day free trial:', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'Trial access is free, requires no card, and ends after 30 days. Continued use requires a valid Founder licence or another offer published later. Download use remains subject to the licence and known limitations included with the installer.', 'clearledger-public-beta-site' ); ?></p>
						</div>
						<div class="cl-download-data">
							<dl>
								<div><dt><?php echo esc_html__( 'Version', 'clearledger-public-beta-site' ); ?></dt><dd><?php echo esc_html( $options['release_version'] ); ?></dd></div>
								<?php if ( $options['release_date'] ) : ?><div><dt><?php echo esc_html__( 'Published', 'clearledger-public-beta-site' ); ?></dt><dd><time datetime="<?php echo esc_attr( $options['release_date'] ); ?>"><?php echo esc_html( $options['release_date'] ); ?></time></dd></div><?php endif; ?>
								<div><dt><?php echo esc_html__( 'SHA-256', 'clearledger-public-beta-site' ); ?></dt><dd><code class="cl-checksum" data-cl-checksum><?php echo $options['sha256'] ? esc_html( $options['sha256'] ) : esc_html__( 'Not yet published', 'clearledger-public-beta-site' ); ?></code></dd></div>
							</dl>
							<div class="cl-download-actions">
								<?php if ( $download_ready ) : ?>
									<a class="cl-button" href="<?php echo esc_url( $options['download_url'] ); ?>" rel="noopener noreferrer"><?php echo esc_html__( 'Download PennyWise for Windows x64', 'clearledger-public-beta-site' ); ?></a>
									<a class="cl-button cl-button-secondary" href="<?php echo esc_url( $options['checksum_url'] ); ?>" rel="noopener noreferrer"><?php echo esc_html__( 'Download .sha256', 'clearledger-public-beta-site' ); ?></a>
									<button class="cl-button cl-button-secondary" type="button" data-cl-copy-checksum><?php echo esc_html__( 'Copy checksum', 'clearledger-public-beta-site' ); ?></button>
								<?php else : ?>
									<span class="cl-button cl-button-disabled" aria-disabled="true"><?php echo esc_html__( 'Download not yet published', 'clearledger-public-beta-site' ); ?></span>
								<?php endif; ?>
							</div>
							<p class="cl-copy-status" role="status" aria-live="polite" data-cl-copy-status></p>
						</div>
						<div class="cl-verify-instructions">
							<h3><?php echo esc_html__( 'Check the archive before opening it', 'clearledger-public-beta-site' ); ?></h3>
							<p><?php echo esc_html__( 'Windows PowerShell:', 'clearledger-public-beta-site' ); ?> <code>Get-FileHash .\PennyWise-Accounting-&lt;version&gt;-x64.msix -Algorithm SHA256</code></p>
							<p><?php echo esc_html__( 'Compare the complete result to the value above. Do not run the installer if any character differs.', 'clearledger-public-beta-site' ); ?></p>
						</div>
					</div>
				</section>

				<section class="cl-install-feedback" aria-label="<?php echo esc_attr__( 'Installation and feedback', 'clearledger-public-beta-site' ); ?>">
					<div class="cl-page-width cl-install-feedback-grid">
						<div id="clearledger-install">
							<h2><?php echo esc_html__( 'Install on a computer you control.', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'The single Windows x64 MSIX includes the PennyWise application, Node.js runtime, and PostgreSQL database. It installs per user, keeps services on localhost, and needs no separate dependency installation.', 'clearledger-public-beta-site' ); ?></p>
							<a class="cl-text-link" href="<?php echo esc_url( $installation ); ?>"><?php echo esc_html__( 'Open the installation guide', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
						</div>
						<div id="clearledger-feedback">
							<h2><?php echo esc_html__( 'Found a problem?', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'Report the version, operating system, browser, exact steps, expected result, actual result, and request ID. Remove names, emails, addresses, tax IDs, account numbers, documents, screenshots of private data, tokens, and provider secrets.', 'clearledger-public-beta-site' ); ?></p>
							<a class="cl-text-link" href="<?php echo esc_url( $support ); ?>"><?php echo esc_html__( 'Open PennyWise support', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
							<a class="cl-text-link" href="<?php echo esc_url( $community ); ?>"><?php echo esc_html__( 'Visit the moderated community board', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
						</div>
					</div>
				</section>
			</div>

			<footer class="cl-footer">
				<div class="cl-page-width cl-footer-grid">
					<div><div class="cl-footer-wordmark">PennyWise Accounting</div><p><?php echo esc_html__( 'Local-first accounting for careful Canadian businesses.', 'clearledger-public-beta-site' ); ?></p></div>
					<nav aria-label="<?php echo esc_attr__( 'PennyWise resources', 'clearledger-public-beta-site' ); ?>">
						<a href="<?php echo esc_url( $limitations ); ?>"><?php echo esc_html__( 'Known limitations', 'clearledger-public-beta-site' ); ?></a>
						<a href="<?php echo esc_url( $installation ); ?>"><?php echo esc_html__( 'Installation guide', 'clearledger-public-beta-site' ); ?></a>
						<a href="<?php echo esc_url( $support ); ?>"><?php echo esc_html__( 'Report a bug', 'clearledger-public-beta-site' ); ?></a>
						<a href="<?php echo esc_url( $community ); ?>"><?php echo esc_html__( 'Community feedback', 'clearledger-public-beta-site' ); ?></a>
						<a href="<?php echo esc_url( $privacy ); ?>"><?php echo esc_html__( 'Privacy', 'clearledger-public-beta-site' ); ?></a>
					</nav>
					<div id="clearledger-privacy" class="cl-footer-privacy">
						<p><?php echo esc_html__( 'This plugin adds no analytics, advertising, or file attachments. Bug reports, suspected security issues, and pending community feedback are stored privately in this WordPress site; only moderator-approved feedback is public.', 'clearledger-public-beta-site' ); ?></p>
						<p>&copy; <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php echo esc_html__( 'Typewriting Monkeys. PennyWise Accounting beta.', 'clearledger-public-beta-site' ); ?></p>
					</div>
				</div>
			</footer>
		</div>
		<?php

		return (string) ob_get_clean();
	}

	/**
	 * Render the stable /clearledger-support/ destination.
	 *
	 * @return string
	 */
	public static function render_support() {
		$options      = ClearLedger_Beta_Settings::get_options();
		$home         = home_url( '/' );
		$installation = $options['installation_url'] ? $options['installation_url'] : $home;
		$limitations  = $options['limitations_url'] ? $options['limitations_url'] : $home;
		$privacy      = $options['privacy_url'] ? $options['privacy_url'] : '#clearledger-support-privacy';

		ob_start();
		?>
		<div class="cl-beta-site cl-support-page" data-cl-beta-site>
			<a class="cl-skip-link" href="#clearledger-support-main"><?php echo esc_html__( 'Skip to PennyWise support', 'clearledger-public-beta-site' ); ?></a>
			<header class="cl-site-header" aria-label="<?php echo esc_attr__( 'PennyWise support', 'clearledger-public-beta-site' ); ?>">
				<div class="cl-page-width cl-support-header-inner">
					<a class="cl-wordmark" href="<?php echo esc_url( $home ); ?>">PennyWise <span>Accounting</span></a>
					<a class="cl-text-link" href="<?php echo esc_url( $home ); ?>"><?php echo esc_html__( 'Return to Typewriting Monkeys', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
				</div>
			</header>

			<div id="clearledger-support-main">
				<section class="cl-support-hero" aria-labelledby="clearledger-support-title">
					<div class="cl-page-width">
						<h1 id="clearledger-support-title"><?php echo esc_html__( 'PennyWise support', 'clearledger-public-beta-site' ); ?></h1>
						<p><?php echo esc_html__( 'Start with the safest path. Keep private accounting data out of bug reports, report suspected security issues privately, and stop any workflow that could change a filing or balance until it is reviewed.', 'clearledger-public-beta-site' ); ?></p>
					</div>
				</section>

				<section class="cl-support-options" aria-label="<?php echo esc_attr__( 'Support options', 'clearledger-public-beta-site' ); ?>">
					<div class="cl-page-width cl-support-grid">
						<article>
							<span class="cl-support-number" aria-hidden="true">01</span>
							<h2><?php echo esc_html__( 'Report a product bug', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'Include the PennyWise version, operating system, browser, exact steps, expected result, actual result, and a request ID where shown.', 'clearledger-public-beta-site' ); ?></p>
							<p><strong><?php echo esc_html__( 'Remove before sending:', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'names, emails, addresses, account or card numbers, tax identifiers, invoices, receipts, statements, screenshots of private data, passwords, tokens, and provider credentials.', 'clearledger-public-beta-site' ); ?></p>
							<p><?php echo esc_html__( 'Use the private form below for product defects. Product reports are never listed on the public community board.', 'clearledger-public-beta-site' ); ?></p>
						</article>

						<article class="cl-security-report">
							<span class="cl-support-number" aria-hidden="true">02</span>
							<h2><?php echo esc_html__( 'Report a suspected security issue privately', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'Use this path for suspected credential exposure, authentication or authorization bypass, cross-organization access, vulnerable download or update behavior, data disclosure, code execution, or a way to alter posted accounting without the intended controls.', 'clearledger-public-beta-site' ); ?></p>
							<p><strong><?php echo esc_html__( 'Do not post security details in public issues, comments, social media, or community forums.', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'Share the minimum evidence needed and do not access, retain, or transmit data that is not yours.', 'clearledger-public-beta-site' ); ?></p>
							<a class="cl-button" href="#clearledger-security-form"><?php echo esc_html__( 'Open private security report', 'clearledger-public-beta-site' ); ?></a>
						</article>
					</div>
				</section>

				<section class="cl-page-width cl-support-intake-wrap">
					<?php ClearLedger_Beta_Submissions::render_bug_form(); ?>
					<?php ClearLedger_Beta_Submissions::render_security_form(); ?>
				</section>

				<section class="cl-support-risk" aria-labelledby="clearledger-risk-title">
					<div class="cl-page-width cl-support-risk-grid">
						<div>
							<h2 id="clearledger-risk-title"><?php echo esc_html__( 'If money, tax, inventory, or a filing could be affected', 'clearledger-public-beta-site' ); ?></h2>
							<p><?php echo esc_html__( 'Stop the affected workflow. Preserve original documents and non-sensitive diagnostic evidence, make an organization export and backup, and have the result reviewed before continuing. Do not repair a posted record by editing accounting history directly.', 'clearledger-public-beta-site' ); ?></p>
						</div>
						<nav aria-label="<?php echo esc_attr__( 'Support resources', 'clearledger-public-beta-site' ); ?>">
							<a href="<?php echo esc_url( $limitations ); ?>"><?php echo esc_html__( 'Known limitations', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
							<a href="<?php echo esc_url( $installation ); ?>"><?php echo esc_html__( 'Installation and recovery guide', 'clearledger-public-beta-site' ); ?><?php echo self::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
						</nav>
					</div>
				</section>
			</div>

			<footer class="cl-footer" id="clearledger-support-privacy">
				<div class="cl-page-width cl-support-footer-inner">
					<div><div class="cl-footer-wordmark">PennyWise Accounting</div><p><?php echo esc_html__( 'Public-beta support with a private security boundary.', 'clearledger-public-beta-site' ); ?></p></div>
					<div class="cl-footer-privacy"><p><?php echo esc_html__( 'Submitted product and security reports stay in separate administrator-only inboxes. Community posts remain private until moderation; private contact details are never rendered publicly.', 'clearledger-public-beta-site' ); ?></p><a href="<?php echo esc_url( $privacy ); ?>"><?php echo esc_html__( 'Privacy', 'clearledger-public-beta-site' ); ?></a></div>
				</div>
			</footer>
		</div>
		<?php

		return (string) ob_get_clean();
	}

	/**
	 * Require same-site ZIP/checksum URLs and a complete checksum.
	 *
	 * @param array<string,string> $options Page options.
	 * @return bool
	 */
	private static function download_is_ready( $options ) {
		return ClearLedger_Beta_Settings::is_same_site_https_url( $options['download_url'] ) &&
			ClearLedger_Beta_Settings::is_same_site_https_url( $options['checksum_url'] ) &&
			1 === preg_match( '/^[a-f0-9]{64}$/', $options['sha256'] );
	}

	/**
	 * Feature row helper.
	 */
	private static function feature( $icon, $title, $description ) {
		?>
		<li>
			<span class="cl-feature-icon"><?php echo self::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
			<h3><?php echo esc_html( $title ); ?></h3>
			<p><?php echo esc_html( $description ); ?></p>
		</li>
		<?php
	}

	/**
	 * Add optional real release screenshots without public placeholders.
	 *
	 * @param array<string,string> $options Page options.
	 */
	private static function render_optional_screenshots( $options ) {
		$images = array(
			array( $options['screenshot_invoice_url'], $options['screenshot_invoice_alt'], __( 'Invoice preview', 'clearledger-public-beta-site' ) ),
			array( $options['screenshot_import_url'], $options['screenshot_import_alt'], __( 'Spreadsheet mapping', 'clearledger-public-beta-site' ) ),
		);
		$images = array_values(
			array_filter(
				$images,
				static function ( $image ) {
					return ! empty( $image[0] );
				}
			)
		);

		if ( empty( $images ) ) {
			return;
		}
		?>
		<section class="cl-screenshots" aria-labelledby="clearledger-screenshots-title">
			<div class="cl-page-width">
				<h2 id="clearledger-screenshots-title"><?php echo esc_html__( 'See the release before you install it.', 'clearledger-public-beta-site' ); ?></h2>
				<div class="cl-screenshot-grid">
					<?php foreach ( $images as $image ) : ?>
						<figure class="cl-release-shot">
							<img src="<?php echo esc_url( $image[0] ); ?>" alt="<?php echo esc_attr( $image[1] ); ?>" loading="lazy" decoding="async" referrerpolicy="no-referrer">
							<figcaption><?php echo esc_html( $image[2] ); ?></figcaption>
						</figure>
					<?php endforeach; ?>
				</div>
			</div>
		</section>
		<?php
	}

	/**
	 * Render an honest, code-native product preview until release screenshots exist.
	 */
	private static function render_illustrative_preview() {
		?>
		<figure class="cl-product-preview">
			<div class="cl-preview-window" aria-label="<?php echo esc_attr__( 'Illustrative PennyWise Accounting interface preview', 'clearledger-public-beta-site' ); ?>">
				<aside class="cl-preview-sidebar" aria-hidden="true">
					<div class="cl-preview-mark">CL</div>
					<span class="is-active"><?php echo esc_html__( 'Home', 'clearledger-public-beta-site' ); ?></span>
					<span><?php echo esc_html__( 'Receivables &amp; sales', 'clearledger-public-beta-site' ); ?></span>
					<span><?php echo esc_html__( 'Payables &amp; purchases', 'clearledger-public-beta-site' ); ?></span>
					<span><?php echo esc_html__( 'Inventory', 'clearledger-public-beta-site' ); ?></span>
					<span><?php echo esc_html__( 'CRM &amp; clients', 'clearledger-public-beta-site' ); ?></span>
					<span><?php echo esc_html__( 'Switching centre', 'clearledger-public-beta-site' ); ?></span>
					<span><?php echo esc_html__( 'Tax centre', 'clearledger-public-beta-site' ); ?></span>
				</aside>
				<div class="cl-preview-main">
					<div class="cl-preview-toolbar"><strong><?php echo esc_html__( 'Overview', 'clearledger-public-beta-site' ); ?></strong><span><b>CAD</b><b>USD</b></span></div>
					<div class="cl-preview-metrics">
						<div><span><?php echo esc_html__( 'Books health', 'clearledger-public-beta-site' ); ?></span><strong><?php echo esc_html__( 'Review ready', 'clearledger-public-beta-site' ); ?></strong><small><?php echo esc_html__( 'Demo status', 'clearledger-public-beta-site' ); ?></small></div>
						<div><span><?php echo esc_html__( 'Invoices due', 'clearledger-public-beta-site' ); ?></span><strong><?php echo esc_html__( 'Prioritized', 'clearledger-public-beta-site' ); ?></strong><small><?php echo esc_html__( 'Demo status', 'clearledger-public-beta-site' ); ?></small></div>
						<div><span><?php echo esc_html__( 'Commerce review', 'clearledger-public-beta-site' ); ?></span><strong><?php echo esc_html__( 'Needs review', 'clearledger-public-beta-site' ); ?></strong><small><?php echo esc_html__( 'Demo status', 'clearledger-public-beta-site' ); ?></small></div>
					</div>
					<div class="cl-preview-workspace">
						<div class="cl-preview-list"><strong><?php echo esc_html__( 'Work to review', 'clearledger-public-beta-site' ); ?></strong><span></span><span></span><span></span><span></span></div>
						<div class="cl-preview-invoice"><small><?php echo esc_html__( 'INVOICE PREVIEW', 'clearledger-public-beta-site' ); ?></small><strong><?php echo esc_html__( 'Sample company', 'clearledger-public-beta-site' ); ?></strong><hr><span></span><span></span><span></span><hr><b><?php echo esc_html__( 'Ready to preview', 'clearledger-public-beta-site' ); ?></b></div>
					</div>
				</div>
			</div>
			<figcaption><?php echo esc_html__( 'Illustrative interface preview. Final beta screens and demo data may differ.', 'clearledger-public-beta-site' ); ?></figcaption>
		</figure>
		<?php
	}

	/**
	 * Inline decorative/control SVGs. All icons are hidden from assistive technology.
	 *
	 * @param string $name Icon name.
	 * @return string
	 */
	private static function icon( $name ) {
		$icons = array(
			'maple'     => '<svg class="cl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.5l1.6 3.4 3.5-1.6-.9 3.9 3.8.7-2.9 3.1 2.3 1.5-4.6 3 .6 2.6-3.4-.7V23h-2v-5.2l-3.4.7.6-2.6-4.6-3L6.9 11 4 7.9l3.8-.7-.9-3.9 3.5 1.6L12 1.5z" fill="currentColor"/></svg>',
			'export'    => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M7 3h12l6 6v20H7zM19 3v7h6M16 24V12m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
			'map'       => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 10h23m-5-5 5 5-5 5M28 22H5m5 5-5-5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
			'verify'    => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10 16 4 4 8-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
			'invoice'   => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M8 3h16v26H8zM12 10h8m-8 5h8m-8 5h5M16 7v16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
			'bill'      => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M8 3l3 2 3-2 3 2 3-2 4 2v24l-4-2-3 2-3-2-3 2-3-2zM12 11h8m-8 5h8m-8 5h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
			'inventory' => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m16 3 12 6-12 6L4 9zm12 6v14l-12 6L4 23V9m12 6v14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
			'calendar'  => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="5" y="7" width="22" height="21" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3v8m12-8v8M5 13h22M10 18h1m5 0h1m5 0h1m-13 5h1m5 0h1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
			'sheet'     => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="4" y="4" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 11h24M4 18h24M4 25h24M11 4v24m9-24v24" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
			'tax'       => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M8 3h12l5 5v21H8zM20 3v6h5M12 23l8-10m-7 1.5h.1m5.9 7h.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			'health'    => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 3 27 7v8c0 7-4.7 11.8-11 14-6.3-2.2-11-7-11-14V7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10 16 4 4 8-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			'currency'  => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="4" y="5" width="24" height="22" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 16h24" stroke="currentColor" stroke-width="1.6"/><text x="7" y="13" font-size="7" font-family="sans-serif" fill="currentColor">CAD</text><text x="7" y="24" font-size="7" font-family="sans-serif" fill="currentColor">USD</text></svg>',
			'store'     => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5 12h22l-2-7H7zm2 0v15h18V12M12 27v-8h8v8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
			'sync'      => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M26 12a11 11 0 0 0-19-3l-3 3m0 0V5m0 7h7M6 20a11 11 0 0 0 19 3l3-3m0 0v7m0-7h-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			'review'    => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M8 3h16v26H8zM12 10h8m-8 5h8m-8 5h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
			'reconcile' => '<svg class="cl-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5 6h9c3 0 5 2 5 5v15H10c-3 0-5-2-5-5zm22 0h-5c-2 0-3 1-3 3v17h3c3 0 5-2 5-5zM9 12h6m-6 5h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			'check'     => '<svg class="cl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12 3 3 6-7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			'arrow'     => '<svg class="cl-icon cl-icon-arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 10h13m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
		);

		return isset( $icons[ $name ] ) ? $icons[ $name ] : '';
	}
}
