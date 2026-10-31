<?php
/**
 * Minimal WordPress-compatible smoke harness for the private plugin package.
 *
 * This is not a substitute for theme/browser QA. It exercises loading,
 * settings sanitization, safe download gating, escaping, and shortcode output
 * without network access or a WordPress database.
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 2 );
}

$plugin = isset( $argv[1] ) ? $argv[1] : '';
if ( ! is_file( $plugin ) ) {
	fwrite( STDERR, "Plugin entry file not found.\n" );
	exit( 2 );
}

define( 'ABSPATH', dirname( $plugin ) . DIRECTORY_SEPARATOR );
define( 'OBJECT', 'OBJECT' );
define( 'HOUR_IN_SECONDS', 3600 );

class WP_Post {
	public $ID = 0;
	public $post_content = '';
	public $post_status = 'draft';
}

class WP_Query {
	public $posts = array();
	public $max_num_pages = 0;
	public function __construct( $arguments = array() ) {}
}

$GLOBALS['cl_test_option']          = array();
$GLOBALS['cl_test_settings_errors'] = array();
$GLOBALS['cl_test_inserted_posts']  = array();
$GLOBALS['cl_test_options']         = array();
$GLOBALS['cl_test_post_meta']       = array();
$GLOBALS['cl_test_post_types']      = array();

function plugin_dir_path( $file ) {
	return dirname( $file ) . DIRECTORY_SEPARATOR;
}

function plugin_dir_url( $file ) {
	return 'https://typewritingmonkeys.com/wp-content/plugins/' . basename( dirname( $file ) ) . '/';
}

function plugin_basename( $file ) {
	return basename( dirname( $file ) ) . '/' . basename( $file );
}

function add_action() {}
function add_filter() {}
function add_shortcode() {}
function register_activation_hook() {}
function register_post_type( $name, $arguments ) {
	$GLOBALS['cl_test_post_types'][ $name ] = $arguments;
}
function add_meta_box() {}
function add_options_page() {}
function register_setting() {}
function wp_enqueue_style() {}
function wp_enqueue_script() {}
function wp_enqueue_media() {}
function settings_fields() {}
function submit_button() {}
function selected() {}

function is_singular() {
	return true;
}

function has_shortcode( $content, $tag ) {
	return false !== strpos( $content, '[' . $tag . ']' );
}

function current_user_can( $capability ) {
	return in_array( $capability, array( 'manage_options', 'edit_post' ), true );
}

function admin_url( $path ) {
	return 'https://typewritingmonkeys.com/wp-admin/' . ltrim( $path, '/' );
}

function home_url( $path = '/' ) {
	return 'https://typewritingmonkeys.com' . '/' . ltrim( $path, '/' );
}

function get_option( $name, $default = false ) {
	if ( 'clearledger_beta_site_options' === $name ) {
		return $GLOBALS['cl_test_option'];
	}
	return isset( $GLOBALS['cl_test_options'][ $name ] ) ? $GLOBALS['cl_test_options'][ $name ] : $default;
}

function delete_option() {}

function update_option( $name, $value ) {
	$GLOBALS['cl_test_options'][ $name ] = $value;
	return true;
}

function get_page_by_path( $path ) {
	foreach ( $GLOBALS['cl_test_inserted_posts'] as $index => $post ) {
		if ( isset( $post['post_name'] ) && $post['post_name'] === $path ) {
			$found = new WP_Post();
			$found->ID = $index + 1;
			$found->post_content = $post['post_content'];
			$found->post_status = $post['post_status'];
			return $found;
		}
	}
	return null;
}

function wp_insert_post( $post, $wp_error = false ) {
	$GLOBALS['cl_test_inserted_posts'][] = $post;
	return 101;
}

function sanitize_text_field( $value ) {
	return trim( preg_replace( '/\s+/', ' ', strip_tags( (string) $value ) ) );
}

function sanitize_textarea_field( $value ) {
	return trim( strip_tags( (string) $value ) );
}

function wp_unslash( $value ) {
	return $value;
}

function absint( $value ) {
	return abs( (int) $value );
}

function sanitize_key( $value ) {
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) );
}

function sanitize_email( $value ) {
	return filter_var( $value, FILTER_SANITIZE_EMAIL );
}

function esc_url_raw( $url, $protocols = null ) {
	$parts = parse_url( (string) $url );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return '';
	}
	if ( is_array( $protocols ) && ! in_array( strtolower( $parts['scheme'] ), $protocols, true ) ) {
		return '';
	}
	return filter_var( $url, FILTER_SANITIZE_URL );
}

function wp_parse_url( $url, $component = -1 ) {
	return parse_url( $url, $component );
}

function get_post_type( $post_id ) {
	return 'attachment';
}

function wp_get_attachment_url( $post_id ) {
	return '';
}

function get_attached_file( $post_id ) {
	return '';
}

function add_settings_error( $setting, $code, $message ) {
	$GLOBALS['cl_test_settings_errors'][] = array( $setting, $code, $message );
}

function esc_html( $value ) {
	return htmlspecialchars( (string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}

function esc_attr( $value ) {
	return esc_html( $value );
}

function esc_url( $value ) {
	return esc_html( $value );
}

function __( $value ) {
	return $value;
}

function esc_html__( $value ) {
	return esc_html( $value );
}

function esc_attr__( $value ) {
	return esc_attr( $value );
}

function wp_date( $format ) {
	return date( $format );
}

function wp_max_upload_size() {
	return 2 * 1024 * 1024 * 1024;
}

function size_format( $bytes ) {
	return '2 GB';
}

function wp_nonce_field( $action, $name ) {
	echo '<input type="hidden" name="' . esc_attr( $name ) . '" value="test-nonce">';
}

function wp_verify_nonce() {
	return true;
}

function is_wp_error() {
	return false;
}

function update_post_meta( $post_id, $key, $value ) {
	$GLOBALS['cl_test_post_meta'][ $post_id ][ $key ] = $value;
}

function get_post_meta( $post_id, $key, $single = false ) {
	return isset( $GLOBALS['cl_test_post_meta'][ $post_id ][ $key ] ) ? $GLOBALS['cl_test_post_meta'][ $post_id ][ $key ] : '';
}

function get_transient() {
	return 0;
}

function set_transient() {
	return true;
}

function wp_salt() {
	return 'clearledger-test-salt';
}

function add_query_arg( $key, $value = null, $url = null ) {
	if ( is_array( $key ) ) {
		$url   = (string) $value;
		$query = $key;
	} else {
		$query = array( $key => $value );
	}
	return $url . '?' . http_build_query( $query, '', '&' );
}

function paginate_links() {
	return array();
}

function get_post_time() {
	return '2026-08-03T00:00:00Z';
}

function get_the_date() {
	return 'August 3, 2026';
}

function get_the_title( $post ) {
	return isset( $post->post_title ) ? $post->post_title : '';
}

function wp_kses_post( $value ) {
	return $value;
}

function wp_is_post_autosave() {
	return false;
}

function wp_is_post_revision() {
	return false;
}

function wp_update_post() {
	return 1;
}

function cl_assert( $condition, $message ) {
	if ( ! $condition ) {
		fwrite( STDERR, "FAIL: $message\n" );
		exit( 1 );
	}
}

require $plugin;
clearledger_beta_site_bootstrap();
clearledger_beta_site_activate();
ClearLedger_Beta_Submissions::register_post_types();

cl_assert( 3 === count( $GLOBALS['cl_test_inserted_posts'] ), 'Activation must create landing, support, and community drafts when the routes are absent.' );
$created_pages = array();
foreach ( $GLOBALS['cl_test_inserted_posts'] as $created_page ) {
	$created_pages[ $created_page['post_name'] ] = $created_page;
}
cl_assert( isset( $created_pages['clearledger-public-beta'] ), 'Activation must reserve /clearledger-public-beta/.' );
cl_assert( isset( $created_pages['clearledger-support'] ), 'Activation must reserve /clearledger-support/.' );
cl_assert( isset( $created_pages['clearledger-community'] ), 'Activation must reserve /clearledger-community/.' );
cl_assert( 'draft' === $created_pages['clearledger-public-beta']['post_status'], 'Activation must not publish the landing page before review.' );
cl_assert( 'draft' === $created_pages['clearledger-support']['post_status'], 'Activation must not publish the support page before review.' );
cl_assert( 'draft' === $created_pages['clearledger-community']['post_status'], 'Activation must not publish the community page before review.' );
cl_assert( '[clearledger_beta]' === $created_pages['clearledger-public-beta']['post_content'], 'Landing page must use the dedicated shortcode.' );
cl_assert( '[clearledger_support]' === $created_pages['clearledger-support']['post_content'], 'Support page must use the dedicated shortcode.' );
cl_assert( '[clearledger_community]' === $created_pages['clearledger-community']['post_content'], 'Community page must use the dedicated shortcode.' );

$invalid = ClearLedger_Beta_Settings::sanitize(
	array(
		'release_version'          => '<script>alert(1)</script> 0.15.0-beta.1',
		'release_date'             => '2026-02-31',
		'download_url'             => 'https://example.com/PennyWise-Accounting-0.15.0-beta.1-x64.msix',
		'checksum_url'             => 'https://example.com/PennyWise-Accounting-0.15.0-beta.1-x64.msix.sha256',
		'sha256'                   => 'not-a-hash',
		'feedback_url'             => 'http://example.com/feedback',
		'founder_checkout_url'     => 'https://evil.example/checkout',
		'founder_terms_url'        => 'http://example.com/founder-terms',
		'screenshot_dashboard_alt' => '<b>Dashboard</b>',
	)
);
cl_assert( '' === $invalid['download_url'], 'Unsafe download URL must be rejected.' );
cl_assert( '' === $invalid['checksum_url'], 'Cross-site checksum URL must be rejected.' );
cl_assert( '' === $invalid['feedback_url'], 'Non-HTTPS feedback URL must be rejected.' );
cl_assert( '' === $invalid['founder_checkout_url'], 'Non-Stripe founder checkout URL must be rejected.' );
cl_assert( '' === $invalid['founder_terms_url'], 'Non-HTTPS founder terms URL must be rejected.' );
cl_assert( '' === $invalid['sha256'], 'Malformed checksum must be rejected.' );
cl_assert( '' === $invalid['release_date'], 'Malformed release date must be rejected.' );
cl_assert( 'alert(1) 0.15.0-beta.1' === $invalid['release_version'], 'Release version text must be stripped of markup.' );
cl_assert( 'Dashboard' === $invalid['screenshot_dashboard_alt'], 'Screenshot alternative text must be plain text.' );
cl_assert( count( $GLOBALS['cl_test_settings_errors'] ) >= 4, 'Invalid public values must produce administrator-visible settings errors.' );

$embedded_credential = ClearLedger_Beta_Settings::sanitize(
	array(
		'download_url' => 'https://user:password@typewritingmonkeys.com/PennyWise-Accounting-0.15.0-beta.1-x64.msix',
	)
);
cl_assert( '' === $embedded_credential['download_url'], 'URL credentials must never be stored in a public link.' );

$GLOBALS['cl_test_option'] = array();
$default_html              = ClearLedger_Beta_Page::render();
cl_assert( 1 === substr_count( $default_html, '<h1' ), 'The page must have exactly one visible H1.' );
cl_assert( false !== strpos( $default_html, 'Download not yet published' ), 'Default rendering must fail closed.' );
cl_assert( false !== strpos( $default_html, 'Illustrative interface preview' ), 'Default rendering must label the illustrative preview.' );
cl_assert( false === strpos( $default_html, '<form' ), 'The public shortcode must not collect form data.' );
cl_assert( false === strpos( $default_html, 'Continue to secure Stripe checkout' ), 'Hosted checkout CTA must remain absent until the owner configures it.' );
cl_assert( false !== strpos( $default_html, 'Request founder access' ), 'Manual founder fulfilment must remain available when checkout is not configured.' );

$valid_sha = str_repeat( 'a1', 32 );
$valid     = ClearLedger_Beta_Settings::sanitize(
	array(
		'release_version'          => '0.15.0-beta.1',
		'release_date'             => '2026-08-03',
		'download_url'             => 'https://downloads.typewritingmonkeys.com/PennyWise-Accounting-0.15.0-beta.1-x64.msix',
		'checksum_url'             => 'https://downloads.typewritingmonkeys.com/PennyWise-Accounting-0.15.0-beta.1-x64.msix.sha256',
		'sha256'                   => $valid_sha,
		'feedback_url'             => 'https://typewritingmonkeys.com/clearledger-feedback/',
		'founder_checkout_url'     => 'https://buy.stripe.com/test_clearledger_founder',
		'founder_terms_url'        => 'https://typewritingmonkeys.com/founder-terms/',
		'screenshot_dashboard_url' => 'https://typewritingmonkeys.com/wp-content/uploads/clearledger-demo.png',
		'screenshot_dashboard_alt' => 'Demo dashboard without customer data.',
	)
);
$GLOBALS['cl_test_option'] = $valid;
$ready_html                = ClearLedger_Beta_Page::render();
cl_assert( false !== strpos( $ready_html, $valid_sha ), 'Published checksum must be rendered.' );
cl_assert( false !== strpos( $ready_html, 'downloads.typewritingmonkeys.com' ), 'Validated HTTPS download URL must be rendered.' );
cl_assert( false !== strpos( $ready_html, '.msix.sha256' ), 'Ready release must link the published checksum file.' );
cl_assert( false !== strpos( $ready_html, 'data-cl-copy-checksum' ), 'Checksum copy control must be present for a ready release.' );
cl_assert( false === strpos( $ready_html, 'Download not yet published' ), 'Ready release must not show the disabled download state.' );
cl_assert( false === strpos( $ready_html, '<script>alert(1)</script>' ), 'Unsafe settings markup must not reach the page.' );
cl_assert( false !== strpos( $ready_html, 'https://buy.stripe.com/test_clearledger_founder' ), 'Approved hosted Stripe Checkout URL must be rendered.' );
cl_assert( false !== strpos( $ready_html, 'Continue to secure Stripe checkout' ), 'Configured hosted Stripe Checkout CTA must be rendered.' );
cl_assert( false !== strpos( $ready_html, 'https://typewritingmonkeys.com/founder-terms/' ), 'Optional HTTPS founder terms link must be rendered.' );
cl_assert( false === strpos( $ready_html, 'Request founder access' ), 'Hosted checkout state must not render the manual founder CTA.' );

$stripe_edge_cases = ClearLedger_Beta_Settings::sanitize(
	array(
		'founder_checkout_url' => 'https://buy.stripe.com.evil.example/checkout',
	)
);
cl_assert( '' === $stripe_edge_cases['founder_checkout_url'], 'Stripe lookalike domain must be rejected.' );
$stripe_credentials = ClearLedger_Beta_Settings::sanitize(
	array(
		'founder_checkout_url' => 'https://user:password@buy.stripe.com/checkout',
	)
);
cl_assert( '' === $stripe_credentials['founder_checkout_url'], 'Hosted checkout URL credentials must be rejected.' );

$support_html = ClearLedger_Beta_Page::render_support();
cl_assert( false !== strpos( $support_html, 'Report a suspected security issue privately' ), 'Support page must include private security-reporting guidance.' );
cl_assert( false !== strpos( $support_html, 'Do not post security details in public issues' ), 'Support page must warn against public vulnerability disclosure.' );
cl_assert( 2 === substr_count( $support_html, '<form' ), 'Support page must provide separate private bug and security forms.' );
cl_assert( 2 === substr_count( $support_html, 'name="clearledger_nonce"' ), 'Each private intake form must carry a nonce.' );
cl_assert( false !== strpos( $support_html, 'value="bug"' ), 'Private bug form must identify only the bug workflow.' );
cl_assert( false !== strpos( $support_html, 'value="security"' ), 'Private security form must identify only the security workflow.' );
cl_assert( 2 === substr_count( $support_html, 'name="clearledger_company_website"' ), 'Each private intake form must carry a honeypot field.' );
cl_assert( false !== strpos( $support_html, 'Send a private security report' ), 'Native security intake must render without an external service.' );
cl_assert( false !== strpos( $support_html, 'not end-to-end encrypted' ), 'Security intake must state its storage boundary.' );
cl_assert( false !== strpos( $support_html, 'security_acknowledged' ), 'Security intake must require the safe-data acknowledgement.' );
cl_assert( false === strpos( $support_html, 'type="file"' ), 'Private intake must not accept attachments.' );
cl_assert( false === strpos( $support_html, 'mailto:' ), 'Support page must not invent or embed an email route.' );

$security_type = $GLOBALS['cl_test_post_types']['clearledger_security'];
cl_assert( false === $security_type['publicly_queryable'], 'Security records must not have a public query route.' );
cl_assert( false === $security_type['show_in_rest'], 'Security records must not have a WordPress REST route.' );
cl_assert( false === $security_type['can_export'], 'Security records must not enter ordinary WordPress exports.' );
cl_assert( 'tools.php' === $security_type['show_in_menu'], 'Security records must be reviewed only from the administrator tools menu.' );

$security_create = new ReflectionMethod( 'ClearLedger_Beta_Submissions', 'create_security_report' );
$security_create->setAccessible( true );
$created_security = $security_create->invoke(
	null,
	array(
		'security_summary'         => '<b>Cross-company read</b>',
		'security_version'         => '0.14.0-rc.1',
		'security_category'        => 'authorization',
		'security_severity'        => 'high',
		'security_reproduction'    => "Use fictional companies A and B.\nAttempt a read from A while signed into B.",
		'security_impact'          => 'A user could view records belonging to another fictional company.',
		'security_mitigation'      => 'Stop remote testing until triaged.',
		'security_private_contact' => 'reporter@example.invalid',
		'security_acknowledged'    => '1',
	)
);
cl_assert( true === $created_security, 'A complete bounded security report must be stored.' );
$stored_security = end( $GLOBALS['cl_test_inserted_posts'] );
cl_assert( 'clearledger_security' === $stored_security['post_type'], 'Security intake must use its separate private record type.' );
cl_assert( 'private' === $stored_security['post_status'], 'Security intake must never create a public record.' );
cl_assert( 'Cross-company read' === $stored_security['post_title'], 'Security report titles must be sanitized to plain text.' );
cl_assert( 'reporter@example.invalid' === $GLOBALS['cl_test_post_meta'][101]['_clearledger_private_contact'], 'Security contact must remain private metadata.' );
$rejected_security = $security_create->invoke(
	null,
	array(
		'security_summary' => str_repeat( 'x', 5000 ),
	)
);
cl_assert( false === $rejected_security, 'Oversized or incomplete security reports must be rejected.' );

$community_html = ClearLedger_Beta_Submissions::render_community();
cl_assert( false !== strpos( $community_html, 'Submit feedback for moderation' ), 'Community page must explain the moderation boundary.' );
cl_assert( false !== strpos( $community_html, '<form' ), 'Community page must provide a feedback form.' );
cl_assert( false !== strpos( $community_html, 'name="clearledger_nonce"' ), 'Community form must carry a nonce.' );
cl_assert( false !== strpos( $community_html, 'Optional private contact' ), 'Community form must distinguish private contact details.' );
cl_assert( false === strpos( $community_html, 'type="file"' ), 'Community feedback must not accept attachments.' );

fwrite( STDOUT, "PASS: WordPress stub smoke exercised draft pages, sanitization, fail-closed paired download, separate private bug/security intake, and moderated community feedback.\n" );
