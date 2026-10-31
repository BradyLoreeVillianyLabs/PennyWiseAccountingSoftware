<?php
/**
 * Plugin Name: PennyWise Accounting Launch Site
 * Plugin URI: https://typewritingmonkeys.com/
 * Description: The privacy-conscious PennyWise Accounting launch, trial, founder-offer, guarded-download, and support site.
 * Version: 1.4.2
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Author: Typewriting Monkeys
 * Author URI: https://typewritingmonkeys.com/
 * Text Domain: clearledger-public-beta-site
 * License: Proprietary beta distribution package
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'CLEARLEDGER_BETA_SITE_VERSION', '1.4.2' );
define( 'CLEARLEDGER_BETA_SITE_FILE', __FILE__ );
define( 'CLEARLEDGER_BETA_SITE_DIR', plugin_dir_path( __FILE__ ) );
define( 'CLEARLEDGER_BETA_SITE_URL', plugin_dir_url( __FILE__ ) );

require_once CLEARLEDGER_BETA_SITE_DIR . 'includes/class-clearledger-beta-settings.php';
require_once CLEARLEDGER_BETA_SITE_DIR . 'includes/class-clearledger-beta-page.php';
require_once CLEARLEDGER_BETA_SITE_DIR . 'includes/class-clearledger-beta-submissions.php';

/**
 * Create non-public site-page drafts without replacing existing content.
 * The site owner reviews and publishes them after configuring release links.
 */
function clearledger_beta_site_activate() {
	clearledger_beta_site_ensure_pages();
	update_option( 'clearledger_beta_site_version', CLEARLEDGER_BETA_SITE_VERSION, false );
}

register_activation_hook( __FILE__, 'clearledger_beta_site_activate' );

/**
 * Start the plugin after WordPress has loaded all active plugins.
 */
function clearledger_beta_site_bootstrap() {
	ClearLedger_Beta_Settings::init();
	ClearLedger_Beta_Page::init();
	ClearLedger_Beta_Submissions::init();

	if ( get_option( 'clearledger_beta_site_version', '' ) !== CLEARLEDGER_BETA_SITE_VERSION ) {
		clearledger_beta_site_ensure_pages();
		update_option( 'clearledger_beta_site_version', CLEARLEDGER_BETA_SITE_VERSION, false );
	}
}

add_action( 'plugins_loaded', 'clearledger_beta_site_bootstrap' );

/**
 * Create reviewed-only page drafts without replacing any existing page content.
 */
function clearledger_beta_site_ensure_pages() {
	$pages = array(
		array( 'PennyWise Accounting', 'clearledger-public-beta', '[clearledger_beta]' ),
		array( 'PennyWise Support', 'clearledger-support', '[clearledger_support]' ),
		array( 'PennyWise Community', 'clearledger-community', '[clearledger_community]' ),
	);

	foreach ( $pages as $page ) {
		if ( get_page_by_path( $page[1], OBJECT, 'page' ) instanceof WP_Post ) {
			continue;
		}
		wp_insert_post(
			array(
				'post_title'   => $page[0],
				'post_name'    => $page[1],
				'post_content' => $page[2],
				'post_status'  => 'draft',
				'post_type'    => 'page',
			),
			true
		);
	}
}
