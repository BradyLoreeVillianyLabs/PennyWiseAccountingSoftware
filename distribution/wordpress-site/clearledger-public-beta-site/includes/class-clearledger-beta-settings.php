<?php
/**
 * Administrative settings for the public-beta page.
 *
 * @package ClearLedger_Public_Beta_Site
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ClearLedger_Beta_Settings {
	const OPTION_NAME = 'clearledger_beta_site_options';

	/**
	 * Register hooks.
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_menu', array( __CLASS__, 'add_settings_page' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin_assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( CLEARLEDGER_BETA_SITE_FILE ), array( __CLASS__, 'action_links' ) );
		add_filter( 'upload_mimes', array( __CLASS__, 'release_upload_types' ) );
	}

	/**
	 * Safe defaults intentionally publish no external link.
	 *
	 * @return array<string,string>
	 */
	public static function defaults() {
		return array(
			'release_version'          => 'Public beta',
			'release_date'             => '',
			'download_attachment_id'   => '0',
			'download_url'             => '',
			'checksum_attachment_id'   => '0',
			'checksum_url'             => '',
			'sha256'                   => '',
			'installation_attachment_id' => '0',
			'installation_url'         => '',
			'limitations_attachment_id' => '0',
			'limitations_url'          => '',
			'feedback_url'             => '',
			'privacy_url'              => '',
			'founder_checkout_url'     => '',
			'founder_terms_url'        => '',
			'screenshot_dashboard_url' => '',
			'screenshot_dashboard_alt' => 'PennyWise Accounting dashboard showing books health and review work.',
			'screenshot_invoice_url'   => '',
			'screenshot_invoice_alt'   => 'PennyWise Accounting invoice preview.',
			'screenshot_import_url'    => '',
			'screenshot_import_alt'    => 'PennyWise Accounting spreadsheet column-mapping preview.',
		);
	}

	/**
	 * Read options with defaults.
	 *
	 * @return array<string,string>
	 */
	public static function get_options() {
		$stored = get_option( self::OPTION_NAME, array() );

		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$options = array_merge( self::defaults(), $stored );
		foreach ( self::attachment_url_map() as $id_key => $url_key ) {
			$id = absint( $options[ $id_key ] );
			if ( $id > 0 ) {
				$options[ $url_key ] = self::resolve_attachment_url( $id );
			}
		}
		return $options;
	}

	/**
	 * Register one bounded options record.
	 */
	public static function register() {
		register_setting(
			'clearledger_beta_site',
			self::OPTION_NAME,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => self::defaults(),
			)
		);
	}

	/**
	 * Sanitize settings before storage.
	 *
	 * @param mixed $input Submitted settings.
	 * @return array<string,string>
	 */
	public static function sanitize( $input ) {
		$defaults = self::defaults();
		$input    = is_array( $input ) ? $input : array();
		$output   = $defaults;

		$output['release_version'] = sanitize_text_field( isset( $input['release_version'] ) ? $input['release_version'] : '' );
		if ( '' === $output['release_version'] ) {
			$output['release_version'] = $defaults['release_version'];
		}

		$release_date = sanitize_text_field( isset( $input['release_date'] ) ? $input['release_date'] : '' );
		$parsed_date = '' !== $release_date ? DateTimeImmutable::createFromFormat( '!Y-m-d', $release_date ) : false;
		if ( '' !== $release_date && ( ! $parsed_date || $parsed_date->format( 'Y-m-d' ) !== $release_date ) ) {
			add_settings_error( self::OPTION_NAME, 'clearledger_invalid_date', __( 'Release date must use YYYY-MM-DD.', 'clearledger-public-beta-site' ) );
			$release_date = '';
		}
		$output['release_date'] = $release_date;

		foreach ( self::attachment_url_map() as $id_key => $url_key ) {
			$output[ $id_key ] = (string) absint( isset( $input[ $id_key ] ) ? $input[ $id_key ] : 0 );
		}

		$output['download_url']     = self::sanitize_same_site_https_url( $input, 'download_url', __( 'Download URL', 'clearledger-public-beta-site' ) );
		$output['checksum_url']     = self::sanitize_same_site_https_url( $input, 'checksum_url', __( 'Checksum file URL', 'clearledger-public-beta-site' ) );
		$output['installation_url'] = self::sanitize_same_site_https_url( $input, 'installation_url', __( 'Installation guide URL', 'clearledger-public-beta-site' ) );
		$output['limitations_url']  = self::sanitize_same_site_https_url( $input, 'limitations_url', __( 'Known limitations URL', 'clearledger-public-beta-site' ) );
		$output['feedback_url']     = self::sanitize_same_site_https_url( $input, 'feedback_url', __( 'Legacy feedback URL', 'clearledger-public-beta-site' ) );
		$output['privacy_url']      = self::sanitize_same_site_https_url( $input, 'privacy_url', __( 'Privacy URL', 'clearledger-public-beta-site' ) );
		$output['founder_checkout_url'] = self::sanitize_stripe_checkout_url( $input, 'founder_checkout_url', __( 'Founder checkout URL', 'clearledger-public-beta-site' ) );
		$output['founder_terms_url']    = self::sanitize_https_url( $input, 'founder_terms_url', __( 'Founder terms URL', 'clearledger-public-beta-site' ) );

		foreach ( self::attachment_url_map() as $id_key => $url_key ) {
			$id = absint( $output[ $id_key ] );
			if ( $id > 0 ) {
				$output[ $url_key ] = self::resolve_attachment_url( $id, $url_key );
			}
		}

		$output['screenshot_dashboard_url'] = self::sanitize_https_url( $input, 'screenshot_dashboard_url', __( 'Dashboard screenshot URL', 'clearledger-public-beta-site' ) );
		$output['screenshot_invoice_url']   = self::sanitize_https_url( $input, 'screenshot_invoice_url', __( 'Invoice screenshot URL', 'clearledger-public-beta-site' ) );
		$output['screenshot_import_url']    = self::sanitize_https_url( $input, 'screenshot_import_url', __( 'Import screenshot URL', 'clearledger-public-beta-site' ) );

		$output['screenshot_dashboard_alt'] = self::sanitize_alt( $input, 'screenshot_dashboard_alt', $defaults['screenshot_dashboard_alt'] );
		$output['screenshot_invoice_alt']   = self::sanitize_alt( $input, 'screenshot_invoice_alt', $defaults['screenshot_invoice_alt'] );
		$output['screenshot_import_alt']    = self::sanitize_alt( $input, 'screenshot_import_alt', $defaults['screenshot_import_alt'] );

		$sha256 = strtolower( preg_replace( '/\s+/', '', isset( $input['sha256'] ) ? (string) $input['sha256'] : '' ) );
		if ( '' !== $sha256 && ! preg_match( '/^[a-f0-9]{64}$/', $sha256 ) ) {
			add_settings_error( self::OPTION_NAME, 'clearledger_invalid_sha256', __( 'SHA-256 must be exactly 64 hexadecimal characters. The invalid value was not saved.', 'clearledger-public-beta-site' ) );
			$sha256 = '';
		}
		$output['sha256'] = $sha256;
		self::validate_release_pair( $output );

		return $output;
	}

	/**
	 * Accept release/document formats that WordPress.com may not enable by default.
	 * Administrators still remain subject to the host's plan, storage, and per-file limit.
	 */
	public static function release_upload_types( $mimes ) {
		$mimes['zip']    = 'application/zip';
		$mimes['msix']   = 'application/msix';
		$mimes['sha256'] = 'text/plain';
		$mimes['md']     = 'text/markdown';
		return $mimes;
	}

	/**
	 * Load the Media Library picker only on this plugin's settings page.
	 */
	public static function enqueue_admin_assets( $hook ) {
		if ( 'settings_page_clearledger-public-beta-site' !== $hook ) {
			return;
		}
		wp_enqueue_media();
		wp_enqueue_script(
			'clearledger-public-beta-admin',
			CLEARLEDGER_BETA_SITE_URL . 'assets/js/admin.js',
			array( 'jquery' ),
			CLEARLEDGER_BETA_SITE_VERSION,
			true
		);
	}

	/**
	 * Accept only absolute HTTPS URLs.
	 *
	 * @param array<string,mixed> $input Input record.
	 * @param string              $key Field key.
	 * @param string              $label Human label.
	 * @return string
	 */
	private static function sanitize_https_url( $input, $key, $label ) {
		$raw = isset( $input[ $key ] ) ? trim( (string) $input[ $key ] ) : '';
		if ( '' === $raw ) {
			return '';
		}

		$url    = esc_url_raw( $raw, array( 'https' ) );
		$scheme = wp_parse_url( $url, PHP_URL_SCHEME );
		$host   = wp_parse_url( $url, PHP_URL_HOST );
		$user   = wp_parse_url( $url, PHP_URL_USER );
		$pass   = wp_parse_url( $url, PHP_URL_PASS );

		if ( ! $url || 'https' !== strtolower( (string) $scheme ) || ! $host || $user || $pass ) {
			add_settings_error(
				self::OPTION_NAME,
				'clearledger_invalid_url_' . sanitize_key( $key ),
				sprintf(
					/* translators: %s is a settings field label. */
					__( '%s must be a complete HTTPS URL. The invalid value was not saved.', 'clearledger-public-beta-site' ),
					$label
				)
			);
			return '';
		}

		return $url;
	}

	/**
	 * Accept only this site's HTTPS host or a subdomain beneath it.
	 */
	private static function sanitize_same_site_https_url( $input, $key, $label ) {
		$raw = isset( $input[ $key ] ) ? trim( (string) $input[ $key ] ) : '';
		if ( '' === $raw ) {
			return '';
		}
		$url = esc_url_raw( $raw, array( 'https' ) );
		if ( ! self::is_same_site_https_url( $url ) ) {
			add_settings_error(
				self::OPTION_NAME,
				'clearledger_invalid_site_url_' . sanitize_key( $key ),
				sprintf(
					/* translators: %s is a settings field label. */
					__( '%s must be an HTTPS URL on this site or one of its subdomains. The invalid value was not saved.', 'clearledger-public-beta-site' ),
					$label
				)
			);
			return '';
		}
		return $url;
	}

	/**
	 * Accept only Stripe-hosted checkout URLs. This is a public destination only;
	 * payment credentials and Stripe API keys must never be entered in WordPress.
	 */
	private static function sanitize_stripe_checkout_url( $input, $key, $label ) {
		$raw = isset( $input[ $key ] ) ? trim( (string) $input[ $key ] ) : '';
		if ( '' === $raw ) {
			return '';
		}

		$url    = esc_url_raw( $raw, array( 'https' ) );
		$scheme = strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) );
		$host   = strtolower( rtrim( (string) wp_parse_url( $url, PHP_URL_HOST ), '.' ) );
		$user   = wp_parse_url( $url, PHP_URL_USER );
		$pass   = wp_parse_url( $url, PHP_URL_PASS );
		$port   = wp_parse_url( $url, PHP_URL_PORT );
		$path   = (string) wp_parse_url( $url, PHP_URL_PATH );

		if ( ! $url || 'https' !== $scheme || ! in_array( $host, array( 'buy.stripe.com', 'checkout.stripe.com' ), true ) || $user || $pass || $port || '' === trim( $path, '/' ) ) {
			add_settings_error(
				self::OPTION_NAME,
				'clearledger_invalid_stripe_checkout_url',
				sprintf(
					/* translators: %s is a settings field label. */
					__( '%s must be an HTTPS hosted Stripe Checkout link on buy.stripe.com or checkout.stripe.com. The invalid value was not saved.', 'clearledger-public-beta-site' ),
					$label
				)
			);
			return '';
		}

		return $url;
	}

	/**
	 * Determine whether a public URL remains on the owner-controlled site domain.
	 */
	public static function is_same_site_https_url( $url ) {
		if ( ! $url ) {
			return false;
		}
		$scheme = strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) );
		$host   = strtolower( rtrim( (string) wp_parse_url( $url, PHP_URL_HOST ), '.' ) );
		$home   = strtolower( rtrim( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ), '.' ) );
		$user   = wp_parse_url( $url, PHP_URL_USER );
		$pass   = wp_parse_url( $url, PHP_URL_PASS );
		return 'https' === $scheme && $host && $home && ! $user && ! $pass && ( $host === $home || self::ends_with( $host, '.' . $home ) );
	}

	private static function ends_with( $value, $suffix ) {
		return 0 === substr_compare( $value, $suffix, -strlen( $suffix ) );
	}

	private static function attachment_url_map() {
		return array(
			'download_attachment_id'     => 'download_url',
			'checksum_attachment_id'     => 'checksum_url',
			'installation_attachment_id' => 'installation_url',
			'limitations_attachment_id'  => 'limitations_url',
		);
	}

	private static function resolve_attachment_url( $attachment_id, $field = '' ) {
		$url = 'attachment' === get_post_type( $attachment_id ) ? wp_get_attachment_url( $attachment_id ) : false;
		if ( $url && self::is_same_site_https_url( $url ) ) {
			return $url;
		}
		if ( $field ) {
			add_settings_error( self::OPTION_NAME, 'clearledger_invalid_attachment_' . sanitize_key( $field ), __( 'The selected Media Library item is missing or is not served over HTTPS from this site. It was not used.', 'clearledger-public-beta-site' ) );
		}
		return '';
	}

	/**
	 * Require a versioned ZIP, its sibling checksum file, and matching local bytes.
	 * Manual same-domain URLs are supported for an owner-managed download subdomain.
	 */
	private static function validate_release_pair( &$output ) {
		if ( '' === $output['download_url'] && '' === $output['checksum_url'] && '' === $output['sha256'] ) {
			return;
		}
		$archive_name  = rawurldecode( basename( (string) wp_parse_url( $output['download_url'], PHP_URL_PATH ) ) );
		$checksum_name = rawurldecode( basename( (string) wp_parse_url( $output['checksum_url'], PHP_URL_PATH ) ) );
		$valid_names   = 1 === preg_match( '/^PennyWise-Accounting-[A-Za-z0-9][A-Za-z0-9._-]*-x64\.msix$/', $archive_name ) && $checksum_name === $archive_name . '.sha256';
		if ( ! $valid_names ) {
			self::invalidate_release( $output, __( 'Use a versioned PennyWise-Accounting-<version>-x64.msix URL and its exact .msix.sha256 sibling.', 'clearledger-public-beta-site' ) );
			return;
		}

		$archive_id  = absint( $output['download_attachment_id'] );
		$checksum_id = absint( $output['checksum_attachment_id'] );
		if ( $archive_id <= 0 && $checksum_id <= 0 ) {
			return;
		}
		if ( $archive_id <= 0 || $checksum_id <= 0 ) {
			self::invalidate_release( $output, __( 'Select both the ZIP and checksum from the Media Library, or use both manual same-domain URLs.', 'clearledger-public-beta-site' ) );
			return;
		}

		$archive_path  = get_attached_file( $archive_id );
		$checksum_path = get_attached_file( $checksum_id );
		if ( ! $archive_path || ! is_readable( $archive_path ) || ! $checksum_path || ! is_readable( $checksum_path ) || filesize( $checksum_path ) > 4096 ) {
			self::invalidate_release( $output, __( 'WordPress could not safely read the selected ZIP and checksum files.', 'clearledger-public-beta-site' ) );
			return;
		}

		$checksum_text = trim( (string) file_get_contents( $checksum_path ) );
		if ( ! preg_match( '/^([a-fA-F0-9]{64})(?:\s+\*?([^\s]+))?$/', $checksum_text, $matches ) || ( isset( $matches[2] ) && '' !== $matches[2] && basename( $matches[2] ) !== $archive_name ) ) {
			self::invalidate_release( $output, __( 'The selected checksum file is malformed or names a different archive.', 'clearledger-public-beta-site' ) );
			return;
		}
		$file_hash = strtolower( $matches[1] );
		$real_hash = strtolower( (string) hash_file( 'sha256', $archive_path ) );
		if ( $file_hash !== $real_hash || ( '' !== $output['sha256'] && $output['sha256'] !== $real_hash ) ) {
			self::invalidate_release( $output, __( 'The selected ZIP, checksum file, and saved SHA-256 do not agree. Download publication remains disabled.', 'clearledger-public-beta-site' ) );
			return;
		}
		$output['sha256'] = $real_hash;
	}

	private static function invalidate_release( &$output, $message ) {
		add_settings_error( self::OPTION_NAME, 'clearledger_release_pair_invalid', $message );
		$output['download_url'] = '';
		$output['checksum_url'] = '';
		$output['sha256']       = '';
	}

	/**
	 * Sanitize descriptive alternative text.
	 *
	 * @param array<string,mixed> $input Input record.
	 * @param string              $key Field key.
	 * @param string              $fallback Safe fallback.
	 * @return string
	 */
	private static function sanitize_alt( $input, $key, $fallback ) {
		$value = sanitize_text_field( isset( $input[ $key ] ) ? $input[ $key ] : '' );
		return '' !== $value ? $value : $fallback;
	}

	/**
	 * Add Settings -> PennyWise Launch.
	 */
	public static function add_settings_page() {
		add_options_page(
			__( 'PennyWise Accounting Launch Site', 'clearledger-public-beta-site' ),
			__( 'PennyWise Launch', 'clearledger-public-beta-site' ),
			'manage_options',
			'clearledger-public-beta-site',
			array( __CLASS__, 'render_settings_page' )
		);
	}

	/**
	 * Add a direct settings link in the plugin list.
	 *
	 * @param array<int,string> $links Existing links.
	 * @return array<int,string>
	 */
	public static function action_links( $links ) {
		$url = admin_url( 'options-general.php?page=clearledger-public-beta-site' );
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'clearledger-public-beta-site' ) . '</a>' );
		return $links;
	}

	/**
	 * Render a compact admin form.
	 */
	public static function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$options = self::get_options();
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'PennyWise Accounting Launch Site', 'clearledger-public-beta-site' ); ?></h1>
			<p><?php echo esc_html__( 'Configure public display values only. Never enter credentials, private tester data, customer records, or other secrets here.', 'clearledger-public-beta-site' ); ?></p>
			<p><strong><?php echo esc_html__( 'Publish gate:', 'clearledger-public-beta-site' ); ?></strong> <?php echo esc_html__( 'The download stays disabled until a versioned ZIP, its .sha256 sibling, and a matching 64-character hash use HTTPS on this site or an owner-controlled subdomain.', 'clearledger-public-beta-site' ); ?></p>
			<p><?php echo esc_html( sprintf( __( 'This host currently reports a maximum single upload size of %s. The active WordPress.com Personal plan provides finite shared storage; if the final ZIP exceeds either limit, use a same-domain download subdomain backed by the owner-controlled publisher instead of weakening this gate.', 'clearledger-public-beta-site' ), size_format( wp_max_upload_size() ) ) ); ?></p>
			<form action="options.php" method="post" autocomplete="off">
				<?php settings_fields( 'clearledger_beta_site' ); ?>
				<table class="form-table" role="presentation">
					<tbody>
						<?php self::text_row( 'release_version', __( 'Release version', 'clearledger-public-beta-site' ), $options['release_version'], __( 'Public label shown beside the download. Example: 0.15.0-beta.1.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::text_row( 'release_date', __( 'Release date', 'clearledger-public-beta-site' ), $options['release_date'], __( 'Optional. Use YYYY-MM-DD.', 'clearledger-public-beta-site' ), 'date' ); ?>
						<?php self::attachment_row( 'download_attachment_id', __( 'Windows x64 MSIX in Media Library', 'clearledger-public-beta-site' ), $options['download_attachment_id'], $options['download_url'], __( 'Use the final Store-signed MSIX when it fits this plan and the displayed upload limit.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::attachment_row( 'checksum_attachment_id', __( 'Installer checksum in Media Library', 'clearledger-public-beta-site' ), $options['checksum_attachment_id'], $options['checksum_url'], __( 'Select the exact PennyWise-Accounting-<version>-x64.msix.sha256 sibling.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'download_url', __( 'Manual same-domain MSIX URL', 'clearledger-public-beta-site' ), $options['download_url'], __( 'Fallback for an owner-managed HTTPS download subdomain. A Media Library selection overrides this value.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'checksum_url', __( 'Manual same-domain checksum URL', 'clearledger-public-beta-site' ), $options['checksum_url'], __( 'Must be the MSIX URL plus .sha256. A Media Library selection overrides this value.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::text_row( 'sha256', __( 'Archive SHA-256', 'clearledger-public-beta-site' ), $options['sha256'], __( 'Required to enable downloads. Paste the 64-character hash created by the beta release builder.', 'clearledger-public-beta-site' ), 'text', 'regular-text code' ); ?>
						<?php self::attachment_row( 'installation_attachment_id', __( 'Installation guide in Media Library', 'clearledger-public-beta-site' ), $options['installation_attachment_id'], $options['installation_url'], __( 'Optional same-site PDF, text, or Markdown document.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'installation_url', __( 'Installation guide URL', 'clearledger-public-beta-site' ), $options['installation_url'], __( 'Optional same-domain HTTPS page or document. The Media Library selection overrides it.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::attachment_row( 'limitations_attachment_id', __( 'Known limitations in Media Library', 'clearledger-public-beta-site' ), $options['limitations_attachment_id'], $options['limitations_url'], __( 'Optional same-site PDF, text, or Markdown document.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'limitations_url', __( 'Known limitations URL', 'clearledger-public-beta-site' ), $options['limitations_url'], __( 'Optional same-domain HTTPS page or document. The landing page still includes a concise summary.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'privacy_url', __( 'Privacy URL', 'clearledger-public-beta-site' ), $options['privacy_url'], __( 'Optional same-domain HTTPS privacy page.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'founder_checkout_url', __( 'Founder checkout URL', 'clearledger-public-beta-site' ), $options['founder_checkout_url'], __( 'Optional. Use the hosted Stripe Checkout link only (https://buy.stripe.com/... or https://checkout.stripe.com/...). Leave blank to keep manual founder fulfilment through private support.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'founder_terms_url', __( 'Founder terms URL', 'clearledger-public-beta-site' ), $options['founder_terms_url'], __( 'Optional HTTPS link displayed next to the hosted checkout. Do not put payment credentials or customer data in either URL.', 'clearledger-public-beta-site' ) ); ?>
					</tbody>
				</table>

				<h2><?php echo esc_html__( 'Optional release screenshots', 'clearledger-public-beta-site' ); ?></h2>
				<p><?php echo esc_html__( 'Leave these blank to show the built-in, clearly labelled illustrative preview. Only publish screenshots that contain demo data and no customer or credential information.', 'clearledger-public-beta-site' ); ?></p>
				<table class="form-table" role="presentation">
					<tbody>
						<?php self::url_row( 'screenshot_dashboard_url', __( 'Dashboard screenshot URL', 'clearledger-public-beta-site' ), $options['screenshot_dashboard_url'], __( 'Optional HTTPS image URL from the WordPress media library or another trusted host.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::text_row( 'screenshot_dashboard_alt', __( 'Dashboard alternative text', 'clearledger-public-beta-site' ), $options['screenshot_dashboard_alt'], __( 'Describe what a non-visual visitor should learn from the image.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'screenshot_invoice_url', __( 'Invoice screenshot URL', 'clearledger-public-beta-site' ), $options['screenshot_invoice_url'], __( 'Optional HTTPS image URL.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::text_row( 'screenshot_invoice_alt', __( 'Invoice alternative text', 'clearledger-public-beta-site' ), $options['screenshot_invoice_alt'], __( 'Describe the invoice preview.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::url_row( 'screenshot_import_url', __( 'Import screenshot URL', 'clearledger-public-beta-site' ), $options['screenshot_import_url'], __( 'Optional HTTPS image URL.', 'clearledger-public-beta-site' ) ); ?>
						<?php self::text_row( 'screenshot_import_alt', __( 'Import alternative text', 'clearledger-public-beta-site' ), $options['screenshot_import_alt'], __( 'Describe the import-mapping preview.', 'clearledger-public-beta-site' ) ); ?>
					</tbody>
				</table>

				<?php submit_button( __( 'Save public beta settings', 'clearledger-public-beta-site' ) ); ?>
			</form>
			<hr>
			<p><strong><?php echo esc_html__( 'Landing-page shortcode:', 'clearledger-public-beta-site' ); ?></strong> <code>[clearledger_beta]</code></p>
			<p><strong><?php echo esc_html__( 'Support-page shortcode:', 'clearledger-public-beta-site' ); ?></strong> <code>[clearledger_support]</code> <?php echo esc_html__( 'Activation creates a draft at /clearledger-support/ with separate administrator-only product-bug and security-report inboxes. Test both forms with fictional data before publishing it.', 'clearledger-public-beta-site' ); ?></p>
			<p><strong><?php echo esc_html__( 'Community-page shortcode:', 'clearledger-public-beta-site' ); ?></strong> <code>[clearledger_community]</code> <?php echo esc_html__( 'Activation creates a draft at /clearledger-community/. Submissions remain pending until an administrator publishes them.', 'clearledger-public-beta-site' ); ?></p>
		</div>
		<?php
	}

	/**
	 * Render a URL field row.
	 */
	private static function url_row( $key, $label, $value, $description ) {
		self::text_row( $key, $label, $value, $description, 'url' );
	}

	private static function attachment_row( $key, $label, $value, $url, $description ) {
		$name = self::OPTION_NAME . '[' . $key . ']';
		?>
		<tr data-cl-media-row>
			<th scope="row"><label for="clearledger-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<input id="clearledger-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( $name ); ?>" type="hidden" value="<?php echo esc_attr( absint( $value ) ); ?>" data-cl-media-id>
				<input class="regular-text" type="url" value="<?php echo esc_attr( $url ); ?>" readonly data-cl-media-url aria-label="<?php echo esc_attr( $label ); ?>">
				<button class="button" type="button" data-cl-media-select><?php echo esc_html__( 'Choose from Media Library', 'clearledger-public-beta-site' ); ?></button>
				<button class="button-link-delete" type="button" data-cl-media-clear><?php echo esc_html__( 'Clear selection', 'clearledger-public-beta-site' ); ?></button>
				<p class="description"><?php echo esc_html( $description ); ?></p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render an escaped settings field row.
	 */
	private static function text_row( $key, $label, $value, $description, $type = 'text', $class_name = 'regular-text' ) {
		$name = self::OPTION_NAME . '[' . $key . ']';
		?>
		<tr>
			<th scope="row"><label for="clearledger-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<input
					class="<?php echo esc_attr( $class_name ); ?>"
					id="clearledger-<?php echo esc_attr( $key ); ?>"
					name="<?php echo esc_attr( $name ); ?>"
					type="<?php echo esc_attr( $type ); ?>"
					value="<?php echo esc_attr( $value ); ?>"
					<?php echo 'sha256' === $key ? 'spellcheck="false" maxlength="64"' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				>
				<p class="description"><?php echo esc_html( $description ); ?></p>
			</td>
		</tr>
		<?php
	}
}
