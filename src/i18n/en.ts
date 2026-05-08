const en = {
  lang_name: "English",
  lang_flag: "🇺🇸",
  admin_online: "Admin Online. Use the Menu button for commands.",
  no_blocked_users: "No blocked users.",
  blocked_users_title: "Blocked Users ({count}):\n\n",
  blocked_user_item:
    "{index}. {guestId}\n   Reason: {reason}\n   Date: {date}\n\n",
  unban_button: "Unban {guestId}",
  stats_title: "Statistics:\n\n",
  stats_content:
    "Total Relays: {totalRelays}\nBlocked Users: {totalBlocked}\nAI Blocks: {aiBlocks}\n",
  rss_add_usage: "Usage: /rss_add <url> [title]",
  rss_added:
    "RSS feed added.\nID: {id}\nTitle: {title}\nExisting items recorded: {initialItems}\nNo historical items were sent.",
  rss_error: "RSS error: {message}",
  rss_list_empty: "No RSS feeds configured.",
  rss_list_title: "RSS Feeds ({count}):\n\n",
  rss_list_item:
    "ID: {id}\nTitle: {title}\nURL: {url}\nStatus: {status}\nLast checked: {lastCheckedAt}\n\n",
  rss_list_item_error: "Last error: {error}\n\n",
  rss_remove_usage: "Usage: /rss_remove <id>",
  rss_removed: "RSS feed removed: {id}",
  rss_not_found: "RSS feed not found: {id}",
  rss_title_usage: "Usage: /rss_title <id> <title>",
  rss_title_updated: "RSS feed title updated.\nID: {id}\nTitle: {title}",
  rss_refresh_done:
    "RSS refresh complete.\nChecked: {checked}\nSent: {sent}\nErrors: {errors}\n",
  rss_refresh_error: "\n- {id}: {message}",
  unban_usage: "Usage: /unban <ID>",
  unbanned: "Unbanned: {guestId}",
  blocked: "Banned: {guestId} ({username})",
  trusted:
    "Trusted: {guestId} ({username})\nThis user will skip AI moderation.",
  untrusted:
    "Untrusted: {guestId} ({username})\nThis user will be checked by AI again.",
  unblocked: "Unbanned: {guestId}",
  user_status:
    "User: {guestId} ({username})\nBlocked: {blocked}\nRelay: {status}",
  content_check: "Content Check: {status}",
  image_check: "Image Check: {status}",
  no_content_to_check: "No content to check.",
  cannot_find_user: "Cannot find user info for this message.",
  relay_not_found: "Relay not found.",
  cannot_find_sender: "Cannot find original sender for this message.",
  relay_data_not_found: "Relay data not found.",
  user_blocked_cannot_reply: "This user is blocked. Unban first to reply.",
  appeal_accepted: "Appeal accepted. Unbanned: {guestId}",
  appeal_rejected: "Appeal rejected for: {guestId}",
  invalid_user_id: "Invalid user ID format. ID must be a number.",
  admin_only_action: "Admin only.",
  guest_welcome: "Hello. You can contact me via this bot.",
  guest_blocked:
    "You are blocked.\n\nUse /appeal to submit an appeal.\nTip: Reply to your blocked message with /appeal to attach evidence.",
  guest_not_blocked: "You are not blocked. No need to appeal.",
  guest_appeal_submitted:
    "Your appeal has been submitted. Please wait for admin review.",
  guest_appeal_accepted: "Your appeal has been accepted. You are now unbanned.",
  guest_appeal_rejected: "Your appeal has been rejected.",
  guest_rate_limited: "Too many messages. Please wait {seconds} seconds.",
  guest_message_blocked:
    "Message blocked.\nReason: {reason}\n\nUse /appeal to submit an appeal.\nTip: Reply to this message with /appeal to attach evidence.",
  guest_moderation_unavailable:
    "Message not delivered because moderation is temporarily unavailable. Please try again later.",
  guest_delivery_failed:
    "Message could not be delivered to the admin. Please try again later.",
  guest_error: "An error occurred. Please try again later.",
  appeal_title: "[APPEAL]\n",
  appeal_from: "From: @{username} ({guestId})\n",
  appeal_blocked: "Blocked: {date}\n",
  appeal_reason: "Reason: {reason}\n",
  appeal_separator: "---\n",
  appeal_message: "Appeal message: {content}",
  appeal_no_message: "(No appeal message provided)",
  appeal_accept_button: "Accept (Unban)",
  appeal_reject_button: "Reject",
  lang_select_prompt: "Select your language:",
  lang_changed: "Language changed to English.",
} as const;

export default en;
