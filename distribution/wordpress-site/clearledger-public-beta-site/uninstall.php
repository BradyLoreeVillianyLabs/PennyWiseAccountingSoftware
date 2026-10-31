<?php
/**
 * Remove only the plugin's display settings on uninstall.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'clearledger_beta_site_options' );
delete_option( 'clearledger_beta_site_version' );

// Submitted reports and feedback are intentionally preserved for explicit owner review
// and deletion; uninstall must not silently destroy potentially important reports.
