<?php
/**
 * Separate private bug/security intake and moderated public community feedback.
 *
 * @package ClearLedger_Public_Beta_Site
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ClearLedger_Beta_Submissions {
	const BUG_POST_TYPE              = 'clearledger_bug';
	const SECURITY_POST_TYPE         = 'clearledger_security';
	const FEEDBACK_POST_TYPE         = 'clearledger_feedback';
	const RATE_LIMIT_SECONDS         = HOUR_IN_SECONDS;
	const RATE_LIMIT_ATTEMPTS        = 5;
	const SECURITY_RATE_LIMIT_ATTEMPTS = 3;
	const MAXIMUM_REQUEST_BYTES      = 40000;

	private static $updating_moderation = false;

	/**
	 * Register hooks.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'register_post_types' ) );
		add_action( 'template_redirect', array( __CLASS__, 'handle_submission' ) );
		add_shortcode( 'clearledger_community', array( __CLASS__, 'render_community' ) );
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_moderation_meta_boxes' ) );
		add_action( 'save_post_' . self::BUG_POST_TYPE, array( __CLASS__, 'save_bug_moderation' ), 10, 2 );
		add_action( 'save_post_' . self::SECURITY_POST_TYPE, array( __CLASS__, 'save_security_moderation' ), 10, 2 );
		add_action( 'save_post_' . self::FEEDBACK_POST_TYPE, array( __CLASS__, 'save_feedback_moderation' ), 10, 2 );
		add_filter( 'manage_' . self::BUG_POST_TYPE . '_posts_columns', array( __CLASS__, 'submission_columns' ) );
		add_filter( 'manage_' . self::SECURITY_POST_TYPE . '_posts_columns', array( __CLASS__, 'submission_columns' ) );
		add_filter( 'manage_' . self::FEEDBACK_POST_TYPE . '_posts_columns', array( __CLASS__, 'submission_columns' ) );
		add_action( 'manage_' . self::BUG_POST_TYPE . '_posts_custom_column', array( __CLASS__, 'render_submission_column' ), 10, 2 );
		add_action( 'manage_' . self::SECURITY_POST_TYPE . '_posts_custom_column', array( __CLASS__, 'render_submission_column' ), 10, 2 );
		add_action( 'manage_' . self::FEEDBACK_POST_TYPE . '_posts_custom_column', array( __CLASS__, 'render_submission_column' ), 10, 2 );
	}

	/**
	 * Register admin-only storage types. None has a public route or REST surface.
	 */
	public static function register_post_types() {
		$capabilities = array(
			'edit_post'          => 'manage_options',
			'read_post'          => 'manage_options',
			'delete_post'        => 'manage_options',
			'edit_posts'         => 'manage_options',
			'edit_others_posts'  => 'manage_options',
			'delete_posts'       => 'manage_options',
			'publish_posts'      => 'manage_options',
			'read_private_posts' => 'manage_options',
			'create_posts'       => 'do_not_allow',
		);

		register_post_type(
			self::BUG_POST_TYPE,
			array(
				'labels'             => array(
					'name'          => __( 'PennyWise bug reports', 'clearledger-public-beta-site' ),
					'singular_name' => __( 'PennyWise bug report', 'clearledger-public-beta-site' ),
					'menu_name'     => __( 'PennyWise bugs', 'clearledger-public-beta-site' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => 'tools.php',
				'show_in_rest'       => false,
				'has_archive'        => false,
				'rewrite'            => false,
				'query_var'          => false,
				'can_export'         => false,
				'supports'           => array( 'title', 'editor' ),
				'capabilities'       => $capabilities,
				'map_meta_cap'       => false,
			)
		);

		register_post_type(
			self::SECURITY_POST_TYPE,
			array(
				'labels'             => array(
					'name'          => __( 'PennyWise security reports', 'clearledger-public-beta-site' ),
					'singular_name' => __( 'PennyWise security report', 'clearledger-public-beta-site' ),
					'menu_name'     => __( 'PennyWise security', 'clearledger-public-beta-site' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => 'tools.php',
				'show_in_rest'       => false,
				'has_archive'        => false,
				'rewrite'            => false,
				'query_var'          => false,
				'can_export'         => false,
				'supports'           => array( 'title', 'editor' ),
				'capabilities'       => $capabilities,
				'map_meta_cap'       => false,
			)
		);

		register_post_type(
			self::FEEDBACK_POST_TYPE,
			array(
				'labels'             => array(
					'name'          => __( 'PennyWise community feedback', 'clearledger-public-beta-site' ),
					'singular_name' => __( 'Community feedback', 'clearledger-public-beta-site' ),
					'menu_name'     => __( 'PennyWise feedback', 'clearledger-public-beta-site' ),
				),
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_menu'       => 'tools.php',
				'show_in_rest'       => false,
				'has_archive'        => false,
				'rewrite'            => false,
				'query_var'          => false,
				'can_export'         => false,
				'supports'           => array( 'title', 'editor' ),
				'capabilities'       => $capabilities,
				'map_meta_cap'       => false,
			)
		);
	}

	/**
	 * Process only this plugin's three public forms.
	 */
	public static function handle_submission() {
		if ( 'POST' !== strtoupper( isset( $_SERVER['REQUEST_METHOD'] ) ? (string) $_SERVER['REQUEST_METHOD'] : '' ) ) {
			return;
		}

		$form_value = isset( $_POST['clearledger_form'] ) && is_scalar( $_POST['clearledger_form'] ) ? wp_unslash( $_POST['clearledger_form'] ) : '';
		$form       = sanitize_key( $form_value );
		if ( ! in_array( $form, array( 'bug', 'security', 'community' ), true ) ) {
			return;
		}

		$target         = 'community' === $form ? home_url( '/clearledger-community/' ) : home_url( '/clearledger-support/' );
		$content_length = isset( $_SERVER['CONTENT_LENGTH'] ) ? absint( $_SERVER['CONTENT_LENGTH'] ) : 0;
		$nonce_value    = isset( $_POST['clearledger_nonce'] ) && is_scalar( $_POST['clearledger_nonce'] ) ? wp_unslash( $_POST['clearledger_nonce'] ) : '';
		$nonce          = sanitize_text_field( $nonce_value );
		if ( $content_length > self::MAXIMUM_REQUEST_BYTES || ! empty( $_FILES ) ) {
			self::redirect_with_status( $target, 'invalid', $form );
		}
		if ( ! wp_verify_nonce( $nonce, 'clearledger_' . $form . '_submission' ) ) {
			self::redirect_with_status( $target, 'invalid', $form );
		}

		$honeypot = isset( $_POST['clearledger_company_website'] ) && is_scalar( $_POST['clearledger_company_website'] ) ? trim( (string) wp_unslash( $_POST['clearledger_company_website'] ) ) : '';
		if ( '' !== $honeypot ) {
			self::redirect_with_status( $target, 'received', $form );
		}

		if ( ! self::consume_rate_limit( $form ) ) {
			self::redirect_with_status( $target, 'limited', $form );
		}

		if ( 'bug' === $form ) {
			$created = self::create_bug_report( $_POST );
		} elseif ( 'security' === $form ) {
			$created = self::create_security_report( $_POST );
		} else {
			$created = self::create_community_feedback( $_POST );
		}
		self::redirect_with_status( $target, $created ? 'received' : 'invalid', $form );
	}

	/**
	 * Store a private, admin-only bug report.
	 *
	 * @param array<string,mixed> $input Raw request fields.
	 * @return bool
	 */
	private static function create_bug_report( $input ) {
		$summary     = self::bounded_text( $input, 'summary', 120 );
		$version     = self::bounded_text( $input, 'version', 60 );
		$environment = self::bounded_text( $input, 'environment', 180 );
		$steps       = self::bounded_textarea( $input, 'steps', 3000 );
		$expected    = self::bounded_textarea( $input, 'expected', 1500 );
		$actual      = self::bounded_textarea( $input, 'actual', 1500 );
		$request_id  = self::bounded_text( $input, 'request_id', 120 );
		$contact     = self::bounded_text( $input, 'private_contact', 200 );

		if ( '' === $summary || '' === $version || '' === $environment || '' === $steps || '' === $expected || '' === $actual ) {
			return false;
		}

		$content = implode(
			"\n\n",
			array(
				'PennyWise version: ' . $version,
				'Operating system and browser: ' . $environment,
				'Request ID: ' . ( '' !== $request_id ? $request_id : 'Not supplied' ),
				"Steps to reproduce:\n" . $steps,
				"Expected result:\n" . $expected,
				"Actual result:\n" . $actual,
			)
		);

		$post_id = wp_insert_post(
			array(
				'post_type'    => self::BUG_POST_TYPE,
				'post_status'  => 'private',
				'post_title'   => $summary,
				'post_content' => $content,
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return false;
		}

		update_post_meta( $post_id, '_clearledger_submission_status', 'new' );
		update_post_meta( $post_id, '_clearledger_private_contact', $contact );
		update_post_meta( $post_id, '_clearledger_submitted_at', gmdate( 'c' ) );
		return true;
	}

	/**
	 * Store a suspected vulnerability separately from ordinary product bugs.
	 *
	 * @param array<string,mixed> $input Raw request fields.
	 * @return bool
	 */
	private static function create_security_report( $input ) {
		$categories       = self::security_categories();
		$severities       = self::security_severities();
		$summary          = self::bounded_text( $input, 'security_summary', 120 );
		$version          = self::bounded_text( $input, 'security_version', 60 );
		$category         = self::bounded_key( $input, 'security_category', 40 );
		$severity         = self::bounded_key( $input, 'security_severity', 20 );
		$reproduction     = self::bounded_textarea( $input, 'security_reproduction', 4000 );
		$impact           = self::bounded_textarea( $input, 'security_impact', 2000 );
		$mitigation       = self::bounded_textarea( $input, 'security_mitigation', 1500 );
		$contact          = self::bounded_text( $input, 'security_private_contact', 200 );
		$acknowledged     = isset( $input['security_acknowledged'] ) && is_scalar( $input['security_acknowledged'] ) && '1' === (string) wp_unslash( $input['security_acknowledged'] );

		if ( '' === $summary || '' === $version || ! isset( $categories[ $category ] ) || ! isset( $severities[ $severity ] ) || '' === $reproduction || '' === $impact || '' === $contact || ! $acknowledged ) {
			return false;
		}

		$content = implode(
			"\n\n",
			array(
				'Affected PennyWise version: ' . $version,
				'Category: ' . $categories[ $category ],
				'Reporter severity estimate: ' . $severities[ $severity ],
				"Reproduction with fictional or reporter-owned data:\n" . $reproduction,
				"Potential impact:\n" . $impact,
				"Known mitigation or workaround:\n" . ( '' !== $mitigation ? $mitigation : 'Not supplied' ),
			)
		);

		$post_id = wp_insert_post(
			array(
				'post_type'    => self::SECURITY_POST_TYPE,
				'post_status'  => 'private',
				'post_title'   => $summary,
				'post_content' => $content,
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return false;
		}

		update_post_meta( $post_id, '_clearledger_submission_status', 'new' );
		update_post_meta( $post_id, '_clearledger_security_category', $category );
		update_post_meta( $post_id, '_clearledger_security_severity', $severity );
		update_post_meta( $post_id, '_clearledger_private_contact', $contact );
		update_post_meta( $post_id, '_clearledger_submitted_at', gmdate( 'c' ) );
		return true;
	}

	/**
	 * Store community feedback as pending until an administrator publishes it.
	 *
	 * @param array<string,mixed> $input Raw request fields.
	 * @return bool
	 */
	private static function create_community_feedback( $input ) {
		$categories   = self::community_categories();
		$category_key = self::bounded_key( $input, 'category', 30 );
		$title        = self::bounded_text( $input, 'title', 120 );
		$display_name = self::bounded_text( $input, 'display_name', 80 );
		$message      = self::bounded_textarea( $input, 'message', 2500 );
		$contact      = self::bounded_text( $input, 'private_contact', 200 );

		if ( ! isset( $categories[ $category_key ] ) || '' === $title || '' === $display_name || '' === $message ) {
			return false;
		}

		$post_id = wp_insert_post(
			array(
				'post_type'    => self::FEEDBACK_POST_TYPE,
				'post_status'  => 'pending',
				'post_title'   => $title,
				'post_content' => $message,
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return false;
		}

		update_post_meta( $post_id, '_clearledger_submission_status', 'pending' );
		update_post_meta( $post_id, '_clearledger_feedback_category', $category_key );
		update_post_meta( $post_id, '_clearledger_display_name', $display_name );
		update_post_meta( $post_id, '_clearledger_private_contact', $contact );
		update_post_meta( $post_id, '_clearledger_submitted_at', gmdate( 'c' ) );
		return true;
	}

	/**
	 * Render the private product-bug intake form inside the support page.
	 */
	public static function render_bug_form() {
		$status = self::submission_status( 'bug' );
		?>
		<section class="cl-intake" aria-labelledby="clearledger-bug-form-title">
			<h2 id="clearledger-bug-form-title"><?php echo esc_html__( 'Send a private product bug report', 'clearledger-public-beta-site' ); ?></h2>
			<p><?php echo esc_html__( 'Reports are stored privately in this WordPress site for the owner to review. There are no file attachments. Do not include customer records, financial documents, credentials, tokens, or security-vulnerability details.', 'clearledger-public-beta-site' ); ?></p>
			<?php self::render_status_notice( $status, 'bug' ); ?>
			<form class="cl-submission-form" action="<?php echo esc_url( home_url( '/clearledger-support/' ) ); ?>" method="post">
				<input type="hidden" name="clearledger_form" value="bug">
				<?php wp_nonce_field( 'clearledger_bug_submission', 'clearledger_nonce' ); ?>
				<div class="cl-honeypot" aria-hidden="true"><label for="clearledger-bug-website">Company website</label><input id="clearledger-bug-website" name="clearledger_company_website" type="text" tabindex="-1" autocomplete="off"></div>
				<div class="cl-form-grid">
					<?php self::text_input( 'summary', __( 'Short summary', 'clearledger-public-beta-site' ), 120, true ); ?>
					<?php self::text_input( 'version', __( 'PennyWise version', 'clearledger-public-beta-site' ), 60, true ); ?>
					<?php self::text_input( 'environment', __( 'Operating system and browser', 'clearledger-public-beta-site' ), 180, true ); ?>
					<?php self::text_input( 'request_id', __( 'Request ID, if shown', 'clearledger-public-beta-site' ), 120, false ); ?>
				</div>
				<?php self::textarea_input( 'steps', __( 'Exact steps to reproduce', 'clearledger-public-beta-site' ), 3000, true ); ?>
				<div class="cl-form-grid">
					<?php self::textarea_input( 'expected', __( 'Expected result', 'clearledger-public-beta-site' ), 1500, true ); ?>
					<?php self::textarea_input( 'actual', __( 'Actual result', 'clearledger-public-beta-site' ), 1500, true ); ?>
				</div>
				<?php self::text_input( 'private_contact', __( 'Optional private contact', 'clearledger-public-beta-site' ), 200, false, __( 'Stored for the owner only and never shown on the public community board.', 'clearledger-public-beta-site' ) ); ?>
				<button class="cl-button" type="submit"><?php echo esc_html__( 'Send private bug report', 'clearledger-public-beta-site' ); ?></button>
			</form>
		</section>
		<?php
	}

	/**
	 * Render the native administrator-only suspected-vulnerability intake.
	 */
	public static function render_security_form() {
		$status     = self::submission_status( 'security' );
		$categories = self::security_categories();
		$severities = self::security_severities();
		?>
		<section class="cl-intake cl-security-intake" id="clearledger-security-form" aria-labelledby="clearledger-security-form-title">
			<h2 id="clearledger-security-form-title"><?php echo esc_html__( 'Send a private security report', 'clearledger-public-beta-site' ); ?></h2>
			<p><?php echo esc_html__( 'This report is stored in a separate administrator-only WordPress inbox. It is not published, exposed through WordPress REST, included in ordinary exports, or sent to the community board. It is not end-to-end encrypted.', 'clearledger-public-beta-site' ); ?></p>
			<p><strong><?php echo esc_html__( 'Use only fictional or data you own.', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'Do not submit passwords, API tokens, live credentials, customer records, financial documents, malware, or attachments. Provide the minimum plain-text evidence needed for the owner to reproduce and triage the issue.', 'clearledger-public-beta-site' ); ?></p>
			<?php self::render_status_notice( $status, 'security' ); ?>
			<form class="cl-submission-form" action="<?php echo esc_url( home_url( '/clearledger-support/' ) ); ?>" method="post" autocomplete="off">
				<input type="hidden" name="clearledger_form" value="security">
				<?php wp_nonce_field( 'clearledger_security_submission', 'clearledger_nonce' ); ?>
				<div class="cl-honeypot" aria-hidden="true"><label for="clearledger-security-website">Company website</label><input id="clearledger-security-website" name="clearledger_company_website" type="text" tabindex="-1" autocomplete="off"></div>
				<div class="cl-form-grid">
					<?php self::text_input( 'security_summary', __( 'Short summary', 'clearledger-public-beta-site' ), 120, true ); ?>
					<?php self::text_input( 'security_version', __( 'Affected PennyWise version', 'clearledger-public-beta-site' ), 60, true ); ?>
					<div class="cl-field">
						<label for="clearledger-security-category"><?php echo esc_html__( 'Issue category', 'clearledger-public-beta-site' ); ?> <span aria-hidden="true">*</span></label>
						<select id="clearledger-security-category" name="security_category" required><?php foreach ( $categories as $key => $label ) : ?><option value="<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></option><?php endforeach; ?></select>
					</div>
					<div class="cl-field">
						<label for="clearledger-security-severity"><?php echo esc_html__( 'Your severity estimate', 'clearledger-public-beta-site' ); ?> <span aria-hidden="true">*</span></label>
						<select id="clearledger-security-severity" name="security_severity" required><?php foreach ( $severities as $key => $label ) : ?><option value="<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></option><?php endforeach; ?></select>
					</div>
				</div>
				<?php self::textarea_input( 'security_reproduction', __( 'Reproduction steps using fictional or data you own', 'clearledger-public-beta-site' ), 4000, true ); ?>
				<?php self::textarea_input( 'security_impact', __( 'Potential impact', 'clearledger-public-beta-site' ), 2000, true ); ?>
				<?php self::textarea_input( 'security_mitigation', __( 'Known mitigation or workaround (optional)', 'clearledger-public-beta-site' ), 1500, false ); ?>
				<?php self::text_input( 'security_private_contact', __( 'Private contact for coordinated follow-up', 'clearledger-public-beta-site' ), 200, true, __( 'Required. Provide an email address or another private contact route you monitor. It is stored for administrators only.', 'clearledger-public-beta-site' ) ); ?>
				<label class="cl-check-field" for="clearledger-security-acknowledged"><input id="clearledger-security-acknowledged" name="security_acknowledged" type="checkbox" value="1" required> <span><?php echo esc_html__( 'I used only fictional or data I own and did not include credentials, customer records, financial documents, malware, or attachments.', 'clearledger-public-beta-site' ); ?></span></label>
				<button class="cl-button" type="submit"><?php echo esc_html__( 'Send private security report', 'clearledger-public-beta-site' ); ?></button>
			</form>
		</section>
		<?php
	}

	/**
	 * Render the moderated community board and pending-by-default submission form.
	 *
	 * @return string
	 */
	public static function render_community() {
		$status     = self::submission_status( 'community' );
		$categories = self::community_categories();
		$page       = isset( $_GET['cl_feedback_page'] ) ? max( 1, absint( wp_unslash( $_GET['cl_feedback_page'] ) ) ) : 1;
		$query      = new WP_Query(
			array(
				'post_type'      => self::FEEDBACK_POST_TYPE,
				'post_status'    => 'publish',
				'posts_per_page' => 8,
				'paged'          => $page,
				'orderby'        => 'date',
				'order'          => 'DESC',
			)
		);

		ob_start();
		?>
		<div class="cl-beta-site cl-community-page" data-cl-beta-site>
			<a class="cl-skip-link" href="#clearledger-community-main"><?php echo esc_html__( 'Skip to community feedback', 'clearledger-public-beta-site' ); ?></a>
			<header class="cl-site-header" aria-label="<?php echo esc_attr__( 'PennyWise community', 'clearledger-public-beta-site' ); ?>"><div class="cl-page-width cl-support-header-inner"><a class="cl-wordmark" href="<?php echo esc_url( home_url( '/' ) ); ?>">PennyWise <span>Accounting</span></a><a class="cl-text-link" href="<?php echo esc_url( home_url( '/clearledger-support/' ) ); ?>"><?php echo esc_html__( 'Private product support', 'clearledger-public-beta-site' ); ?></a></div></header>
			<main id="clearledger-community-main">
				<section class="cl-support-hero" aria-labelledby="clearledger-community-title"><div class="cl-page-width"><h1 id="clearledger-community-title"><?php echo esc_html__( 'PennyWise community feedback', 'clearledger-public-beta-site' ); ?></h1><p><?php echo esc_html__( 'Share product ideas and workflow feedback. Every submission is reviewed before it appears. Never post customer data, account details, credentials, or security reports here.', 'clearledger-public-beta-site' ); ?></p></div></section>
				<section class="cl-community-content"><div class="cl-page-width cl-community-layout">
					<div>
						<h2><?php echo esc_html__( 'Published feedback', 'clearledger-public-beta-site' ); ?></h2>
						<?php if ( ! empty( $query->posts ) ) : ?>
							<div class="cl-community-list">
								<?php foreach ( $query->posts as $entry ) : ?>
									<?php $category = get_post_meta( $entry->ID, '_clearledger_feedback_category', true ); ?>
									<article class="cl-community-card">
										<p class="cl-community-meta"><span><?php echo esc_html( isset( $categories[ $category ] ) ? $categories[ $category ] : $categories['other'] ); ?></span> · <?php echo esc_html( get_post_meta( $entry->ID, '_clearledger_display_name', true ) ); ?> · <time datetime="<?php echo esc_attr( get_post_time( 'c', true, $entry ) ); ?>"><?php echo esc_html( get_the_date( '', $entry ) ); ?></time></p>
										<h3><?php echo esc_html( get_the_title( $entry ) ); ?></h3>
										<p><?php echo nl2br( esc_html( $entry->post_content ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></p>
									</article>
								<?php endforeach; ?>
							</div>
							<?php self::render_pagination( $page, (int) $query->max_num_pages ); ?>
						<?php else : ?>
							<p class="cl-feedback-unavailable"><?php echo esc_html__( 'No community feedback has been published yet.', 'clearledger-public-beta-site' ); ?></p>
						<?php endif; ?>
					</div>
					<aside class="cl-community-submit" aria-labelledby="clearledger-community-form-title">
						<h2 id="clearledger-community-form-title"><?php echo esc_html__( 'Submit feedback for moderation', 'clearledger-public-beta-site' ); ?></h2>
						<p><?php echo esc_html__( 'Your title, display name, category, and message may become public after review. Optional contact information stays private. HTML and attachments are not accepted.', 'clearledger-public-beta-site' ); ?></p>
						<?php self::render_status_notice( $status, 'community' ); ?>
						<form class="cl-submission-form" action="<?php echo esc_url( home_url( '/clearledger-community/' ) ); ?>" method="post">
							<input type="hidden" name="clearledger_form" value="community">
							<?php wp_nonce_field( 'clearledger_community_submission', 'clearledger_nonce' ); ?>
							<div class="cl-honeypot" aria-hidden="true"><label for="clearledger-community-website">Company website</label><input id="clearledger-community-website" name="clearledger_company_website" type="text" tabindex="-1" autocomplete="off"></div>
							<label for="clearledger-category"><?php echo esc_html__( 'Category', 'clearledger-public-beta-site' ); ?></label>
							<select id="clearledger-category" name="category" required><?php foreach ( $categories as $key => $label ) : ?><option value="<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></option><?php endforeach; ?></select>
							<?php self::text_input( 'title', __( 'Title', 'clearledger-public-beta-site' ), 120, true ); ?>
							<?php self::text_input( 'display_name', __( 'Display name', 'clearledger-public-beta-site' ), 80, true ); ?>
							<?php self::textarea_input( 'message', __( 'Feedback', 'clearledger-public-beta-site' ), 2500, true ); ?>
							<?php self::text_input( 'private_contact', __( 'Optional private contact', 'clearledger-public-beta-site' ), 200, false ); ?>
							<button class="cl-button" type="submit"><?php echo esc_html__( 'Submit for review', 'clearledger-public-beta-site' ); ?></button>
						</form>
					</aside>
				</div></section>
			</main>
			<footer class="cl-footer"><div class="cl-page-width cl-support-footer-inner"><div><div class="cl-footer-wordmark">PennyWise Accounting</div><p><?php echo esc_html__( 'Moderated public feedback with a private contact boundary.', 'clearledger-public-beta-site' ); ?></p></div><div class="cl-footer-privacy"><p><?php echo esc_html__( 'Published feedback is public. Pending, rejected, and private-contact fields remain visible only to site administrators.', 'clearledger-public-beta-site' ); ?></p></div></div></footer>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Public, fixed category list.
	 *
	 * @return array<string,string>
	 */
	public static function community_categories() {
		return array(
			'idea'          => __( 'Product idea', 'clearledger-public-beta-site' ),
			'workflow'      => __( 'Workflow', 'clearledger-public-beta-site' ),
			'usability'     => __( 'Usability', 'clearledger-public-beta-site' ),
			'documentation' => __( 'Documentation', 'clearledger-public-beta-site' ),
			'other'         => __( 'Other', 'clearledger-public-beta-site' ),
		);
	}

	/**
	 * Fixed suspected-vulnerability categories.
	 *
	 * @return array<string,string>
	 */
	public static function security_categories() {
		return array(
			'authentication'   => __( 'Authentication or session handling', 'clearledger-public-beta-site' ),
			'authorization'    => __( 'Authorization or cross-company access', 'clearledger-public-beta-site' ),
			'data_disclosure'  => __( 'Data disclosure or privacy', 'clearledger-public-beta-site' ),
			'ledger_integrity' => __( 'Accounting or ledger integrity control', 'clearledger-public-beta-site' ),
			'update_download'  => __( 'Download, update, backup, or restore', 'clearledger-public-beta-site' ),
			'code_execution'   => __( 'Code execution or injection', 'clearledger-public-beta-site' ),
			'other'            => __( 'Other suspected security issue', 'clearledger-public-beta-site' ),
		);
	}

	/**
	 * Reporter estimates are triage hints, not final classifications.
	 *
	 * @return array<string,string>
	 */
	public static function security_severities() {
		return array(
			'unsure'   => __( 'Unsure', 'clearledger-public-beta-site' ),
			'low'      => __( 'Low', 'clearledger-public-beta-site' ),
			'medium'   => __( 'Medium', 'clearledger-public-beta-site' ),
			'high'     => __( 'High', 'clearledger-public-beta-site' ),
			'critical' => __( 'Critical', 'clearledger-public-beta-site' ),
		);
	}

	/**
	 * Add one moderation box to each admin-only submission type.
	 */
	public static function add_moderation_meta_boxes() {
		add_meta_box( 'clearledger-bug-moderation', __( 'Review status and private metadata', 'clearledger-public-beta-site' ), array( __CLASS__, 'render_bug_moderation' ), self::BUG_POST_TYPE, 'side', 'high' );
		add_meta_box( 'clearledger-security-moderation', __( 'Security triage and private metadata', 'clearledger-public-beta-site' ), array( __CLASS__, 'render_security_moderation' ), self::SECURITY_POST_TYPE, 'side', 'high' );
		add_meta_box( 'clearledger-feedback-moderation', __( 'Moderation and private metadata', 'clearledger-public-beta-site' ), array( __CLASS__, 'render_feedback_moderation' ), self::FEEDBACK_POST_TYPE, 'side', 'high' );
	}

	public static function render_bug_moderation( $post ) {
		self::render_moderation_box( $post, array( 'new' => 'New', 'in_review' => 'In review', 'resolved' => 'Resolved', 'closed' => 'Closed' ) );
	}

	public static function render_security_moderation( $post ) {
		self::render_moderation_box( $post, array( 'new' => 'New', 'triaged' => 'Triaged', 'investigating' => 'Investigating', 'resolved' => 'Resolved', 'duplicate' => 'Duplicate', 'closed' => 'Closed' ) );
	}

	public static function render_feedback_moderation( $post ) {
		self::render_moderation_box( $post, array( 'pending' => 'Pending', 'published' => 'Published', 'rejected' => 'Rejected' ) );
	}

	private static function render_moderation_box( $post, $statuses ) {
		$current = get_post_meta( $post->ID, '_clearledger_submission_status', true );
		$contact = get_post_meta( $post->ID, '_clearledger_private_contact', true );
		$created = get_post_meta( $post->ID, '_clearledger_submitted_at', true );
		wp_nonce_field( 'clearledger_moderate_submission', 'clearledger_moderation_nonce' );
		?>
		<p><label for="clearledger-moderation-status"><strong><?php echo esc_html__( 'Status', 'clearledger-public-beta-site' ); ?></strong></label></p>
		<select id="clearledger-moderation-status" name="clearledger_moderation_status"><?php foreach ( $statuses as $key => $label ) : ?><option value="<?php echo esc_attr( $key ); ?>" <?php selected( $current, $key ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?></select>
		<p><strong><?php echo esc_html__( 'Submitted', 'clearledger-public-beta-site' ); ?>:</strong> <?php echo esc_html( $created ? $created : __( 'Unknown', 'clearledger-public-beta-site' ) ); ?></p>
		<p><strong><?php echo esc_html__( 'Private contact', 'clearledger-public-beta-site' ); ?>:</strong><br><?php echo esc_html( $contact ? $contact : __( 'Not supplied', 'clearledger-public-beta-site' ) ); ?></p>
		<?php if ( self::SECURITY_POST_TYPE === $post->post_type ) : ?>
			<?php $category = get_post_meta( $post->ID, '_clearledger_security_category', true ); ?>
			<?php $severity = get_post_meta( $post->ID, '_clearledger_security_severity', true ); ?>
			<p><strong><?php echo esc_html__( 'Category', 'clearledger-public-beta-site' ); ?>:</strong><br><?php echo esc_html( isset( self::security_categories()[ $category ] ) ? self::security_categories()[ $category ] : $category ); ?></p>
			<p><strong><?php echo esc_html__( 'Reporter severity estimate', 'clearledger-public-beta-site' ); ?>:</strong><br><?php echo esc_html( isset( self::security_severities()[ $severity ] ) ? self::security_severities()[ $severity ] : $severity ); ?></p>
			<p><em><?php echo esc_html__( 'Keep this report private. Verify scope and impact before changing its triage state.', 'clearledger-public-beta-site' ); ?></em></p>
		<?php endif; ?>
		<?php
	}

	public static function save_bug_moderation( $post_id, $post ) {
		self::save_moderation( $post_id, $post, array( 'new', 'in_review', 'resolved', 'closed' ), false );
	}

	public static function save_security_moderation( $post_id, $post ) {
		self::save_moderation( $post_id, $post, array( 'new', 'triaged', 'investigating', 'resolved', 'duplicate', 'closed' ), false );
	}

	public static function save_feedback_moderation( $post_id, $post ) {
		self::save_moderation( $post_id, $post, array( 'pending', 'published', 'rejected' ), true );
	}

	private static function save_moderation( $post_id, $post, $allowed, $updates_visibility ) {
		if ( self::$updating_moderation || wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$nonce = isset( $_POST['clearledger_moderation_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['clearledger_moderation_nonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'clearledger_moderate_submission' ) ) {
			return;
		}
		$status = isset( $_POST['clearledger_moderation_status'] ) ? sanitize_key( wp_unslash( $_POST['clearledger_moderation_status'] ) ) : '';
		if ( ! in_array( $status, $allowed, true ) ) {
			return;
		}
		update_post_meta( $post_id, '_clearledger_submission_status', $status );
		if ( $updates_visibility ) {
			$post_status = 'published' === $status ? 'publish' : ( 'rejected' === $status ? 'draft' : 'pending' );
			if ( $post->post_status !== $post_status ) {
				self::$updating_moderation = true;
				wp_update_post( array( 'ID' => $post_id, 'post_status' => $post_status ) );
				self::$updating_moderation = false;
			}
		}
	}

	public static function submission_columns( $columns ) {
		$columns['clearledger_status']  = __( 'Review status', 'clearledger-public-beta-site' );
		$columns['clearledger_contact'] = __( 'Private contact', 'clearledger-public-beta-site' );
		return $columns;
	}

	public static function render_submission_column( $column, $post_id ) {
		if ( 'clearledger_status' === $column ) {
			echo esc_html( get_post_meta( $post_id, '_clearledger_submission_status', true ) );
		}
		if ( 'clearledger_contact' === $column ) {
			echo get_post_meta( $post_id, '_clearledger_private_contact', true ) ? esc_html__( 'Provided', 'clearledger-public-beta-site' ) : '&mdash;'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
	}

	private static function consume_rate_limit( $form ) {
		$address = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
		$digest  = hash_hmac( 'sha256', $address, wp_salt( 'nonce' ) );
		$key     = 'cl_' . $form . '_' . substr( $digest, 0, 32 );
		$count   = (int) get_transient( $key );
		$maximum = 'security' === $form ? self::SECURITY_RATE_LIMIT_ATTEMPTS : self::RATE_LIMIT_ATTEMPTS;
		if ( $count >= $maximum ) {
			return false;
		}
		set_transient( $key, $count + 1, self::RATE_LIMIT_SECONDS );
		return true;
	}

	private static function redirect_with_status( $target, $status, $form ) {
		wp_safe_redirect(
			add_query_arg(
				array(
					'cl_submission'      => $status,
					'cl_submission_form' => $form,
				),
				$target
			),
			303
		);
		exit;
	}

	private static function submission_status( $form ) {
		$status_value = isset( $_GET['cl_submission'] ) && is_scalar( $_GET['cl_submission'] ) ? wp_unslash( $_GET['cl_submission'] ) : '';
		$form_value   = isset( $_GET['cl_submission_form'] ) && is_scalar( $_GET['cl_submission_form'] ) ? wp_unslash( $_GET['cl_submission_form'] ) : '';
		$status       = sanitize_key( $status_value );
		$status_form  = sanitize_key( $form_value );
		return $status_form === $form && in_array( $status, array( 'received', 'invalid', 'limited' ), true ) ? $status : '';
	}

	private static function render_status_notice( $status, $form ) {
		if ( '' === $status ) {
			return;
		}
		$messages = array(
			'received' => 'community' === $form ? __( 'Thank you. Your feedback is pending moderator review and is not public yet.', 'clearledger-public-beta-site' ) : ( 'security' === $form ? __( 'Thank you. Your suspected security issue was stored in the private administrator security inbox.', 'clearledger-public-beta-site' ) : __( 'Thank you. Your bug report was stored privately for owner review.', 'clearledger-public-beta-site' ) ),
			'invalid'  => __( 'The report was not accepted. Complete every required field within its stated limit and try again.', 'clearledger-public-beta-site' ),
			'limited'  => __( 'Too many reports were submitted from this connection. Please wait an hour before trying again.', 'clearledger-public-beta-site' ),
		);
		?><p class="cl-form-notice cl-form-notice-<?php echo esc_attr( $status ); ?>" role="status"><?php echo esc_html( $messages[ $status ] ); ?></p><?php
	}

	private static function text_input( $name, $label, $maximum, $required, $description = '' ) {
		$id = 'clearledger-' . str_replace( '_', '-', $name );
		?><div class="cl-field"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?><?php echo $required ? ' <span aria-hidden="true">*</span>' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></label><input id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" type="text" maxlength="<?php echo esc_attr( $maximum ); ?>" <?php echo $required ? 'required' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>><?php if ( $description ) : ?><small><?php echo esc_html( $description ); ?></small><?php endif; ?></div><?php
	}

	private static function textarea_input( $name, $label, $maximum, $required ) {
		$id = 'clearledger-' . str_replace( '_', '-', $name );
		?><div class="cl-field"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?><?php echo $required ? ' <span aria-hidden="true">*</span>' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></label><textarea id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" maxlength="<?php echo esc_attr( $maximum ); ?>" rows="6" <?php echo $required ? 'required' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>></textarea></div><?php
	}

	private static function render_pagination( $current, $total ) {
		if ( $total <= 1 ) {
			return;
		}
		$links = paginate_links(
			array(
				'base'      => add_query_arg( 'cl_feedback_page', '%#%', home_url( '/clearledger-community/' ) ),
				'format'    => '',
				'current'   => $current,
				'total'     => $total,
				'type'      => 'array',
				'prev_text' => __( 'Previous', 'clearledger-public-beta-site' ),
				'next_text' => __( 'Next', 'clearledger-public-beta-site' ),
			)
		);
		if ( ! $links ) {
			return;
		}
		?><nav class="cl-pagination" aria-label="<?php echo esc_attr__( 'Community feedback pages', 'clearledger-public-beta-site' ); ?>"><?php foreach ( $links as $link ) : ?><?php echo wp_kses_post( $link ); ?><?php endforeach; ?></nav><?php
	}

	private static function bounded_text( $input, $key, $maximum ) {
		$raw   = self::bounded_raw_value( $input, $key, $maximum );
		$value = '' !== $raw ? sanitize_text_field( $raw ) : '';
		return self::text_length( $value ) <= $maximum ? $value : '';
	}

	private static function bounded_textarea( $input, $key, $maximum ) {
		$raw   = self::bounded_raw_value( $input, $key, $maximum );
		$value = '' !== $raw ? sanitize_textarea_field( $raw ) : '';
		return self::text_length( $value ) <= $maximum ? $value : '';
	}

	private static function bounded_key( $input, $key, $maximum ) {
		$raw   = self::bounded_raw_value( $input, $key, $maximum );
		$value = '' !== $raw ? sanitize_key( $raw ) : '';
		return strlen( $value ) <= $maximum ? $value : '';
	}

	private static function bounded_raw_value( $input, $key, $maximum ) {
		if ( ! isset( $input[ $key ] ) || ! is_scalar( $input[ $key ] ) ) {
			return '';
		}
		$value = (string) wp_unslash( $input[ $key ] );
		return strlen( $value ) <= max( 1024, $maximum * 4 ) ? $value : '';
	}

	private static function text_length( $value ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value ) : strlen( $value );
	}
}
