/* global dijit, __ */

let _widescreen_mode = false;
let hotkey_actions = {};

const App = {
	_rpc_seq: 0,
	global_unread: -1,
	next_seq: function() {
		this._rpc_seq += 1;
		return this._rpc_seq;
	},
	get_seq: function() {
		return this._rpc_seq;
	},
	updateTitle: function() {
		let tmp = "Tiny Tiny RSS";

		if (this.global_unread > 0) {
			tmp = "(" + this.global_unread + ") " + tmp;
		}

		document.title = tmp;
	},
	isCombinedMode: function() {
		return getInitParam("combined_display_mode");
	},
	hotkeyHandler(event) {
		if (event.target.nodeName == "INPUT" || event.target.nodeName == "TEXTAREA") return;

		const action_name = keyeventToAction(event);

		if (action_name) {
			const action_func = hotkey_actions[action_name];

			if (action_func != null) {
				action_func();
				event.stopPropagation();
				return false;
			}
		}
	},
	switchPanelMode: function(wide) {
		if (App.isCombinedMode()) return;

		const article_id = getActiveArticleId();

		if (wide) {
			dijit.byId("headlines-wrap-inner").attr("design", 'sidebar');
			dijit.byId("content-insert").attr("region", "trailing");

			dijit.byId("content-insert").domNode.setStyle({width: '50%',
				height: 'auto',
				borderTopWidth: '0px' });

			if (parseInt(getCookie("ttrss_ci_width")) > 0) {
				dijit.byId("content-insert").domNode.setStyle(
					{width: getCookie("ttrss_ci_width") + "px" });
			}

			$("headlines-frame").setStyle({ borderBottomWidth: '0px' });
			$("headlines-frame").addClassName("wide");

		} else {

			dijit.byId("content-insert").attr("region", "bottom");

			dijit.byId("content-insert").domNode.setStyle({width: 'auto',
				height: '50%',
				borderTopWidth: '0px'});

			if (parseInt(getCookie("ttrss_ci_height")) > 0) {
				dijit.byId("content-insert").domNode.setStyle(
					{height: getCookie("ttrss_ci_height") + "px" });
			}

			$("headlines-frame").setStyle({ borderBottomWidth: '1px' });
			$("headlines-frame").removeClassName("wide");

		}

		Article.closeArticlePanel();

		if (article_id) view(article_id);

		xhrPost("backend.php", {op: "rpc", method: "setpanelmode", wide: wide ? 1 : 0});
	},
	parseRuntimeInfo: function(data) {

		//console.log("parsing runtime info...");

		for (const k in data) {
			const v = data[k];

			if (k == "dep_ts" && parseInt(getInitParam("dep_ts")) > 0) {
				if (parseInt(getInitParam("dep_ts")) < parseInt(v) && getInitParam("reload_on_ts_change")) {
					window.location.reload();
				}
			}

			if (k == "daemon_is_running" && v != 1) {
				notify_error("<span onclick=\"explainError(1)\">Update daemon is not running.</span>", true);
				return;
			}

			if (k == "update_result") {
				const updatesIcon = dijit.byId("updatesIcon").domNode;

				if (v) {
					Element.show(updatesIcon);
				} else {
					Element.hide(updatesIcon);
				}
			}

			if (k == "daemon_stamp_ok" && v != 1) {
				notify_error("<span onclick=\"explainError(3)\">Update daemon is not updating feeds.</span>", true);
				return;
			}

			if (k == "max_feed_id" || k == "num_feeds") {
				if (init_params[k] != v) {
					console.log("feed count changed, need to reload feedlist.");
					Feeds.reload();
				}
			}

			init_params[k] = v;
			notify('');
		}

		PluginHost.run(PluginHost.HOOK_RUNTIME_INFO_LOADED, data);
	},
	handleRpcJson: function(transport) {

		const netalert_dijit = dijit.byId("net-alert");
		let netalert = false;

		if (netalert_dijit) netalert = netalert_dijit.domNode;

		try {
			const reply = JSON.parse(transport.responseText);

			if (reply) {

				const error = reply['error'];

				if (error) {
					const code = error['code'];
					const msg = error['msg'];

					console.warn("[handleRpcJson] received fatal error " + code + "/" + msg);

					if (code != 0) {
						fatalError(code, msg);
						return false;
					}
				}

				const seq = reply['seq'];

				if (seq && this.get_seq() != seq) {
					console.log("[handleRpcJson] sequence mismatch: " + seq +
						" (want: " + this.get_seq() + ")");
					return true;
				}

				const message = reply['message'];

				if (message == "UPDATE_COUNTERS") {
					console.log("need to refresh counters...");
					setInitParam("last_article_id", -1);
					Feeds.requestCounters(true);
				}

				const counters = reply['counters'];

				if (counters)
					Feeds.parseCounters(counters);

				const runtime_info = reply['runtime-info'];

				if (runtime_info)
					this.parseRuntimeInfo(runtime_info);

				if (netalert) netalert.hide();

				return reply;

			} else {
				if (netalert)
					netalert.show();
				else
					notify_error("Communication problem with server.");
			}

		} catch (e) {
			if (netalert)
				netalert.show();
			else
				notify_error("Communication problem with server.");

			console.error(e);
		}

		return false;
	},
};

function search() {
	const query = "backend.php?op=feeds&method=search&param=" +
		param_escape(Feeds.getActiveFeedId() + ":" + Feeds.activeFeedIsCat());

	if (dijit.byId("searchDlg"))
		dijit.byId("searchDlg").destroyRecursive();

	const dialog = new dijit.Dialog({
		id: "searchDlg",
		title: __("Search"),
		style: "width: 600px",
		execute: function() {
			if (this.validate()) {
				Feeds._search_query = this.attr('value');
				this.hide();
				Feeds.viewCurrentFeed();
			}
		},
		href: query});

	dialog.show();
}

function genericSanityCheck() {
	setCookie("ttrss_test", "TEST");

	if (getCookie("ttrss_test") != "TEST") {
		return fatalError(2);
	}

	return true;
}


function init() {

	window.onerror = function(message, filename, lineno, colno, error) {
		report_error(message, filename, lineno, colno, error);
	};

	require(["dojo/_base/kernel",
			"dojo/ready",
			"dojo/parser",
			"dojo/_base/loader",
			"dojo/_base/html",
			"dojo/query",
			"dijit/ProgressBar",
			"dijit/ColorPalette",
			"dijit/Dialog",
			"dijit/form/Button",
			"dijit/form/ComboButton",
			"dijit/form/CheckBox",
			"dijit/form/DropDownButton",
			"dijit/form/FilteringSelect",
			"dijit/form/Form",
			"dijit/form/RadioButton",
			"dijit/form/Select",
			"dijit/form/MultiSelect",
			"dijit/form/SimpleTextarea",
			"dijit/form/TextBox",
			"dijit/form/ComboBox",
			"dijit/form/ValidationTextBox",
			"dijit/InlineEditBox",
			"dijit/layout/AccordionContainer",
			"dijit/layout/BorderContainer",
			"dijit/layout/ContentPane",
			"dijit/layout/TabContainer",
			"dijit/PopupMenuItem",
			"dijit/Menu",
			"dijit/Toolbar",
			"dijit/Tree",
			"dijit/tree/dndSource",
			"dijit/tree/ForestStoreModel",
			"dojo/data/ItemFileWriteStore",
			"fox/FeedStoreModel",
			"fox/FeedTree" ], function (dojo, ready, parser) {

			ready(function() {

				try {
					parser.parse();

					if (!genericSanityCheck())
						return false;

					setLoadingProgress(30);
					init_hotkey_actions();

					const a = document.createElement('audio');
					const hasAudio = !!a.canPlayType;
					const hasSandbox = "sandbox" in document.createElement("iframe");
					const hasMp3 = !!(a.canPlayType && a.canPlayType('audio/mpeg;').replace(/no/, ''));
					const clientTzOffset = new Date().getTimezoneOffset() * 60;

					const params = {
							op: "rpc", method: "sanityCheck", hasAudio: hasAudio,
							hasMp3: hasMp3,
							clientTzOffset: clientTzOffset,
							hasSandbox: hasSandbox
						};

					xhrPost("backend.php", params, (transport) => {
						try {
							backend_sanity_check_callback(transport);
						} catch (e) {
							console.error(e);
						}
					});

				} catch (e) {
					exception_error(e);
				}

			});


	});
}

function init_hotkey_actions() {
	hotkey_actions["next_feed"] = function() {
		const rv = dijit.byId("feedTree").getNextFeed(
			Feeds.getActiveFeedId(), Feeds.activeFeedIsCat());

		if (rv) Feeds.viewfeed({feed: rv[0], is_cat: rv[1], delayed: true})
	};
	hotkey_actions["prev_feed"] = function() {
		const rv = dijit.byId("feedTree").getPreviousFeed(
			Feeds.getActiveFeedId(), Feeds.activeFeedIsCat());

		if (rv) Feeds.viewfeed({feed: rv[0], is_cat: rv[1], delayed: true})
	};
	hotkey_actions["next_article"] = function() {
		moveToPost('next');
	};
	hotkey_actions["prev_article"] = function() {
		moveToPost('prev');
	};
	hotkey_actions["next_article_noscroll"] = function() {
		moveToPost('next', true);
	};
	hotkey_actions["prev_article_noscroll"] = function() {
		moveToPost('prev', true);
	};
	hotkey_actions["next_article_noexpand"] = function() {
		moveToPost('next', true, true);
	};
	hotkey_actions["prev_article_noexpand"] = function() {
		moveToPost('prev', true, true);
	};
	hotkey_actions["search_dialog"] = function() {
		search();
	};
	hotkey_actions["toggle_mark"] = function() {
		selectionToggleMarked();
	};
	hotkey_actions["toggle_publ"] = function() {
		selectionTogglePublished();
	};
	hotkey_actions["toggle_unread"] = function() {
		selectionToggleUnread({no_error: 1});
	};
	hotkey_actions["edit_tags"] = function() {
		const id = getActiveArticleId();
		if (id) {
			editArticleTags(id);
		}
	}
	hotkey_actions["open_in_new_window"] = function() {
		if (getActiveArticleId()) {
			Article.openArticleInNewWindow(getActiveArticleId());
		}
	};
	hotkey_actions["catchup_below"] = function() {
		catchupRelativeToArticle(1);
	};
	hotkey_actions["catchup_above"] = function() {
		catchupRelativeToArticle(0);
	};
	hotkey_actions["article_scroll_down"] = function() {
		scrollArticle(40);
	};
	hotkey_actions["article_scroll_up"] = function() {
		scrollArticle(-40);
	};
	hotkey_actions["close_article"] = function() {
		if (App.isCombinedMode()) {
			cdmCollapseActive();
		} else {
			Article.closeArticlePanel();
		}
	};
	hotkey_actions["email_article"] = function() {
		if (typeof emailArticle != "undefined") {
			emailArticle();
		} else if (typeof mailtoArticle != "undefined") {
			mailtoArticle();
		} else {
			alert(__("Please enable mail plugin first."));
		}
	};
	hotkey_actions["select_all"] = function() {
		selectArticles('all');
	};
	hotkey_actions["select_unread"] = function() {
		selectArticles('unread');
	};
	hotkey_actions["select_marked"] = function() {
		selectArticles('marked');
	};
	hotkey_actions["select_published"] = function() {
		selectArticles('published');
	};
	hotkey_actions["select_invert"] = function() {
		selectArticles('invert');
	};
	hotkey_actions["select_none"] = function() {
		selectArticles('none');
	};
	hotkey_actions["feed_refresh"] = function() {
		if (Feeds.getActiveFeedId() != undefined) {
			Feeds.viewfeed({feed: Feeds.getActiveFeedId(), is_cat: Feeds.activeFeedIsCat()});
			return;
		}
	};
	hotkey_actions["feed_unhide_read"] = function() {
		Feeds.toggleDispRead();
	};
	hotkey_actions["feed_subscribe"] = function() {
		quickAddFeed();
	};
	hotkey_actions["feed_debug_update"] = function() {
		if (!Feeds.activeFeedIsCat() && parseInt(Feeds.getActiveFeedId()) > 0) {
			window.open("backend.php?op=feeds&method=update_debugger&feed_id=" + Feeds.getActiveFeedId() +
				"&csrf_token=" + getInitParam("csrf_token"));
		} else {
			alert("You can't debug this kind of feed.");
		}
	};

	hotkey_actions["feed_debug_viewfeed"] = function() {
		Feeds.viewfeed({feed: Feeds.getActiveFeedId(), is_cat: Feeds.activeFeedIsCat(), viewfeed_debug: true});
	};

	hotkey_actions["feed_edit"] = function() {
		if (Feeds.activeFeedIsCat())
			alert(__("You can't edit this kind of feed."));
		else
			editFeed(Feeds.getActiveFeedId());
	};
	hotkey_actions["feed_catchup"] = function() {
		if (Feeds.getActiveFeedId() != undefined) {
			catchupCurrentFeed();
			return;
		}
	};
	hotkey_actions["feed_reverse"] = function() {
		reverseHeadlineOrder();
	};
	hotkey_actions["feed_toggle_vgroup"] = function() {
		xhrPost("backend.php", {op: "rpc", method: "togglepref", key: "VFEED_GROUP_BY_FEED"}, () => {
			Feeds.viewCurrentFeed();
		})
	};
	hotkey_actions["catchup_all"] = function() {
		Feeds.catchupAllFeeds();
	};
	hotkey_actions["cat_toggle_collapse"] = function() {
		if (Feeds.activeFeedIsCat()) {
			dijit.byId("feedTree").collapseCat(Feeds.getActiveFeedId());
			return;
		}
	};
	hotkey_actions["goto_all"] = function() {
		Feeds.viewfeed({feed: -4});
	};
	hotkey_actions["goto_fresh"] = function() {
		Feeds.viewfeed({feed: -3});
	};
	hotkey_actions["goto_marked"] = function() {
		Feeds.viewfeed({feed: -1});
	};
	hotkey_actions["goto_published"] = function() {
		Feeds.viewfeed({feed: -2});
	};
	hotkey_actions["goto_tagcloud"] = function() {
		Utils.displayDlg(__("Tag cloud"), "printTagCloud");
	};
	hotkey_actions["goto_prefs"] = function() {
		gotoPreferences();
	};
	hotkey_actions["select_article_cursor"] = function() {
		const id = getArticleUnderPointer();
		if (id) {
			const row = $("RROW-" + id);

			if (row) {
				const cb = dijit.getEnclosingWidget(
					row.select(".rchk")[0]);

				if (cb) {
					if (!row.hasClassName("active"))
						cb.attr("checked", !cb.attr("checked"));

					toggleSelectRowById(cb, "RROW-" + id);
					return false;
				}
			}
		}
	};
	hotkey_actions["create_label"] = function() {
		addLabel();
	};
	hotkey_actions["create_filter"] = function() {
		quickAddFilter();
	};
	hotkey_actions["collapse_sidebar"] = function() {
		Feeds.viewCurrentFeed();
	};
	hotkey_actions["toggle_embed_original"] = function() {
		if (typeof embedOriginalArticle != "undefined") {
			if (getActiveArticleId())
				embedOriginalArticle(getActiveArticleId());
		} else {
			alert(__("Please enable embed_original plugin first."));
		}
	};
	hotkey_actions["toggle_widescreen"] = function() {
		if (!App.isCombinedMode()) {
			_widescreen_mode = !_widescreen_mode;

			// reset stored sizes because geometry changed
			setCookie("ttrss_ci_width", 0);
			setCookie("ttrss_ci_height", 0);

			App.switchPanelMode(_widescreen_mode);
		} else {
			alert(__("Widescreen is not available in combined mode."));
		}
	};
	hotkey_actions["help_dialog"] = function() {
		Utils.helpDialog("main");
	};
	hotkey_actions["toggle_combined_mode"] = function() {
		notify_progress("Loading, please wait...");

		const value = App.isCombinedMode() ? "false" : "true";

		xhrPost("backend.php", {op: "rpc", method: "setpref", key: "COMBINED_DISPLAY_MODE", value: value}, () => {
			setInitParam("combined_display_mode",
				!getInitParam("combined_display_mode"));

			Article.closeArticlePanel();
			Feeds.viewCurrentFeed();
		})
	};
	hotkey_actions["toggle_cdm_expanded"] = function() {
		notify_progress("Loading, please wait...");

		const value = getInitParam("cdm_expanded") ? "false" : "true";

		xhrPost("backend.php", { op: "rpc", method: "setpref", key: "CDM_EXPANDED", value: value }, () => {
			setInitParam("cdm_expanded", !getInitParam("cdm_expanded"));
			Feeds.viewCurrentFeed();
		});
	};

}

function init_second_stage() {
	Feeds.reload();
	Article.closeArticlePanel();

	if (parseInt(getCookie("ttrss_fh_width")) > 0) {
		dijit.byId("feeds-holder").domNode.setStyle(
			{width: getCookie("ttrss_fh_width") + "px" });
	}

	dijit.byId("main").resize();

	var tmph = dojo.connect(dijit.byId('feeds-holder'), 'resize',
		function (args) {
			if (args && args.w >= 0) {
				setCookie("ttrss_fh_width", args.w, getInitParam("cookie_lifetime"));
			}
	});

	var tmph = dojo.connect(dijit.byId('content-insert'), 'resize',
		function (args) {
			if (args && args.w >= 0 && args.h >= 0) {
				setCookie("ttrss_ci_width", args.w, getInitParam("cookie_lifetime"));
				setCookie("ttrss_ci_height", args.h, getInitParam("cookie_lifetime"));
			}
	});

	delCookie("ttrss_test");

	const toolbar = document.forms["main_toolbar_form"];

	dijit.getEnclosingWidget(toolbar.view_mode).attr('value',
		getInitParam("default_view_mode"));

	dijit.getEnclosingWidget(toolbar.order_by).attr('value',
		getInitParam("default_view_order_by"));

	const hash_feed_id = hash_get('f');
	const hash_feed_is_cat = hash_get('c') == "1";

	if (hash_feed_id != undefined) {
		Feeds.setActiveFeedId(hash_feed_id, hash_feed_is_cat);
	}

	setLoadingProgress(50);

	// can't use cache_clear() here because viewfeed might not have initialized yet
	if ('sessionStorage' in window && window['sessionStorage'] !== null)
		sessionStorage.clear();

	_widescreen_mode = getInitParam("widescreen");
	App.switchPanelMode(_widescreen_mode);

	Headlines.initScrollHandler();

	console.log("second stage ok");

	if (getInitParam("simple_update")) {
		console.log("scheduling simple feed updater...");
		window.setTimeout(update_random_feed, 30*1000);
	}
}

function quickMenuGo(opid) {
	switch (opid) {
	case "qmcPrefs":
		gotoPreferences();
		break;
	case "qmcLogout":
		document.location.href = "backend.php?op=logout";
		break;
	case "qmcTagCloud":
		Utils.displayDlg(__("Tag cloud"), "printTagCloud");
		break;
	case "qmcSearch":
		search();
		break;
	case "qmcAddFeed":
		quickAddFeed();
		break;
	case "qmcDigest":
		window.location.href = "backend.php?op=digest";
		break;
	case "qmcEditFeed":
		if (Feeds.activeFeedIsCat())
			alert(__("You can't edit this kind of feed."));
		else
			editFeed(Feeds.getActiveFeedId());
		break;
	case "qmcRemoveFeed":
		var actid = Feeds.getActiveFeedId();

		if (Feeds.activeFeedIsCat()) {
			alert(__("You can't unsubscribe from the category."));
			return;
		}

		if (!actid) {
			alert(__("Please select some feed first."));
			return;
		}

		var fn = getFeedName(actid);

		var pr = __("Unsubscribe from %s?").replace("%s", fn);

		if (confirm(pr)) {
			unsubscribeFeed(actid);
		}
		break;
	case "qmcCatchupAll":
		Feeds.catchupAllFeeds();
		break;
	case "qmcShowOnlyUnread":
		Feeds.toggleDispRead();
		break;
	case "qmcToggleWidescreen":
		if (!App.isCombinedMode()) {
			_widescreen_mode = !_widescreen_mode;

			// reset stored sizes because geometry changed
			setCookie("ttrss_ci_width", 0);
			setCookie("ttrss_ci_height", 0);

			App.switchPanelMode(_widescreen_mode);
		} else {
			alert(__("Widescreen is not available in combined mode."));
		}
		break;
	case "qmcHKhelp":
		Utils.helpDialog("main");
		break;
	default:
		console.log("quickMenuGo: unknown action: " + opid);
	}
}

function viewModeChanged() {
	cache_clear();
	return Feeds.viewCurrentFeed('');
}

function inPreferences() {
	return false;
}

function reverseHeadlineOrder() {

	const toolbar = document.forms["main_toolbar_form"];
	const order_by = dijit.getEnclosingWidget(toolbar.order_by);

	let value = order_by.attr('value');

	if (value == "date_reverse")
		value = "default";
	else
		value = "date_reverse";

	order_by.attr('value', value);

	Feeds.viewCurrentFeed();

}

function update_random_feed() {
	console.log("in update_random_feed");

	xhrPost("backend.php", { op: "rpc", method: "updateRandomFeed" }, (transport) => {
		App.handleRpcJson(transport, true);
		window.setTimeout(update_random_feed, 30*1000);
	});
}

function hash_get(key) {
	const kv = window.location.hash.substring(1).toQueryParams();
	return kv[key];
}

function hash_set(key, value) {
	const kv = window.location.hash.substring(1).toQueryParams();
	kv[key] = value;
	window.location.hash = $H(kv).toQueryString();
}

function gotoPreferences() {
	document.location.href = "prefs.php";
}
