import { useAppApi as e, useNotify as t } from "@kirocrew/app-sdk";
import { Btn as n, Card as r, CardTitle as i, EmptyState as a, PageHeader as o } from "@kirocrew/app-sdk/ui";
import { useCallback as s, useEffect as c, useMemo as l, useState as u } from "react";
import { jsx as d, jsxs as f } from "react/jsx-runtime";
// src/shared/helpers.ts
var p = (e) => new Date(e).toLocaleString(void 0, {
	dateStyle: "medium",
	timeStyle: "short"
}), m = (e) => e === null ? "not detected" : `${Math.floor(e / 60)}m ${Math.round(e % 60)}s`;
function h(e) {
	return [...new Set(e.split(/[,\n]/).map((e) => e.trim()).filter(Boolean))];
}
function g(e) {
	return e.length === 0 ? null : Math.round(e.reduce((e, t) => e + t.score, 0) / e.length);
}
var _ = "http://127.0.0.1:4000/";
// src/shared/Daemonwatch.tsx
function v({ kit: e, hauntings: t, onCreate: n }) {
	let [r, i] = u(""), [a, o] = u(""), [s, c] = u(""), [l, p] = u(""), [m, g] = u(""), _ = async (e) => {
		e.preventDefault(), g("");
		try {
			await n({
				hauntingId: r,
				team: a.trim(),
				players: h(s),
				scheduledFor: new Date(l).toISOString()
			}), o(""), c(""), p("");
		} catch (e) {
			g(e.message);
		}
	};
	return /* @__PURE__ */ d(e.Card, {
		title: "Schedule a drill",
		titleId: "schedule-title",
		children: /* @__PURE__ */ f("form", {
			className: "dw-form",
			onSubmit: (e) => void _(e),
			children: [
				/* @__PURE__ */ d("label", {
					htmlFor: "dw-haunting",
					children: "Haunting"
				}),
				/* @__PURE__ */ f("select", {
					id: "dw-haunting",
					value: r,
					onChange: (e) => i(e.target.value),
					required: !0,
					children: [/* @__PURE__ */ d("option", {
						value: "",
						disabled: !0,
						children: "Choose…"
					}), t.map((e) => /* @__PURE__ */ f("option", {
						value: e.id,
						children: [
							e.name,
							" (",
							e.difficulty,
							")"
						]
					}, e.id))]
				}),
				/* @__PURE__ */ d("label", {
					htmlFor: "dw-team",
					children: "Team"
				}),
				/* @__PURE__ */ d("input", {
					id: "dw-team",
					value: a,
					onChange: (e) => o(e.target.value),
					maxLength: 40,
					required: !0
				}),
				/* @__PURE__ */ d("label", {
					htmlFor: "dw-players",
					children: "Players"
				}),
				/* @__PURE__ */ d("textarea", {
					id: "dw-players",
					value: s,
					onChange: (e) => c(e.target.value),
					rows: 3,
					placeholder: "One per line, or comma separated",
					required: !0
				}),
				/* @__PURE__ */ d("label", {
					htmlFor: "dw-when",
					children: "When"
				}),
				/* @__PURE__ */ d("input", {
					id: "dw-when",
					type: "datetime-local",
					value: l,
					onChange: (e) => p(e.target.value),
					required: !0
				}),
				/* @__PURE__ */ d(e.Button, {
					type: "submit",
					variant: "primary",
					children: "Schedule drill"
				}),
				m && /* @__PURE__ */ d("p", {
					className: "error",
					role: "alert",
					children: m
				})
			]
		})
	});
}
function y({ kit: e, drill: t, hauntingName: n, onStart: r, onCancel: i }) {
	let a = g(t.results), o = new Set(t.results.map((e) => e.player)), s = `drill-${t.id}`;
	return /* @__PURE__ */ f(e.Card, {
		title: `${t.team}: ${n}`,
		titleId: s,
		children: [
			/* @__PURE__ */ f("p", {
				className: "muted",
				children: [
					p(t.scheduledFor),
					" · ",
					t.status === "cancelled" ? "cancelled" : `${t.results.length}/${t.players.length} done`,
					a !== null && ` · team average ${a}/100`
				]
			}),
			/* @__PURE__ */ f("table", {
				className: "dw-table",
				children: [
					/* @__PURE__ */ f("caption", {
						className: "sr-only",
						children: ["Results for ", t.team]
					}),
					/* @__PURE__ */ d("thead", { children: /* @__PURE__ */ f("tr", { children: [
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Player"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Score"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Detected"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Root cause"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Fix verified"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Harmful actions"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: /* @__PURE__ */ d("span", {
								className: "sr-only",
								children: "Action"
							})
						})
					] }) }),
					/* @__PURE__ */ d("tbody", { children: t.players.map((n) => {
						let i = t.results.find((e) => e.player === n);
						return /* @__PURE__ */ f("tr", { children: [
							/* @__PURE__ */ d("th", {
								scope: "row",
								children: n
							}),
							/* @__PURE__ */ d("td", { children: i ? `${i.score}/${i.maxScore}` : "—" }),
							/* @__PURE__ */ d("td", { children: i ? m(i.detectionSeconds) : "—" }),
							/* @__PURE__ */ d("td", { children: i ? i.rootCauseCorrect ? "right" : "wrong" : "—" }),
							/* @__PURE__ */ d("td", { children: i ? i.fixVerified ? "yes" : "no" : "—" }),
							/* @__PURE__ */ d("td", { children: i ? i.harmfulActions : "—" }),
							/* @__PURE__ */ d("td", { children: t.status === "scheduled" && /* @__PURE__ */ d(e.Button, {
								onClick: () => r(n),
								ariaLabel: `${o.has(n) ? "Rerun" : "Start"} drill for ${n}`,
								children: o.has(n) ? "Rerun" : "Start"
							}) })
						] }, n);
					}) })
				]
			}),
			t.status === "scheduled" && /* @__PURE__ */ d(e.Button, {
				variant: "danger",
				onClick: i,
				children: "Cancel drill"
			})
		]
	});
}
function b({ kit: e, client: t, notify: n, onStarted: r }) {
	let [i, a] = u([]), [o, l] = u([]), p = s(() => t.list().then(l).catch((e) => n(e.message)), [t, n]);
	c(() => {
		t.hauntings().then(a).catch((e) => n(e.message)), p();
		let e = setInterval(() => void p(), 1e4);
		return () => clearInterval(e);
	}, [
		t,
		n,
		p
	]);
	let m = (e) => i.find((t) => t.id === e)?.name ?? e;
	return /* @__PURE__ */ f("div", {
		className: "dw",
		children: [
			/* @__PURE__ */ d(e.Header, {
				title: "Daemonwatch",
				subtitle: "team drills for Witching Hour"
			}),
			/* @__PURE__ */ d(v, {
				kit: e,
				hauntings: i,
				onCreate: async (e) => {
					await t.create(e), n("Drill scheduled."), await p();
				}
			}),
			/* @__PURE__ */ f("section", {
				"aria-labelledby": "drills-title",
				children: [
					/* @__PURE__ */ d("h2", {
						id: "drills-title",
						children: "Drills"
					}),
					o.length === 0 && /* @__PURE__ */ d(e.Empty, { text: "No drills yet. Schedule one above." }),
					o.map((i) => /* @__PURE__ */ d(y, {
						kit: e,
						drill: i,
						hauntingName: m(i.hauntingId),
						onStart: (e) => void t.start(i.id, e).then(() => {
							n(`Started for ${e}. Opening the player view…`), r(e);
						}).catch((e) => n(e.message)),
						onCancel: () => void t.cancel(i.id).then(p).catch((e) => n(e.message))
					}, i.id))
				]
			})
		]
	});
}
// src/shared/types.ts
function x(e, t) {
	return {
		hauntings: () => e("GET", `${t}/hauntings`),
		list: () => e("GET", `${t}/drills`),
		create: (n) => e("POST", `${t}/drills`, n),
		cancel: (n) => e("DELETE", `${t}/drills/${encodeURIComponent(n)}`),
		start: (n, r) => e("POST", `${t}/drills/${encodeURIComponent(n)}/start`, { player: r })
	};
}
// src/crew/index.tsx
var S = "/apps/daemonwatch/api", C = {
	Header: ({ title: e, subtitle: t }) => /* @__PURE__ */ d(o, {
		title: e,
		subtitle: t
	}),
	Card: ({ title: e, titleId: t, children: n }) => /* @__PURE__ */ f(r, { children: [e && /* @__PURE__ */ d(i, {
		id: t,
		children: e
	}), n] }),
	Button: ({ children: e, onClick: t, type: r = "button", variant: i, ariaLabel: a, disabled: o }) => /* @__PURE__ */ d(n, {
		type: r,
		onClick: t,
		variant: i,
		"aria-label": a,
		disabled: o,
		children: e
	}),
	Empty: ({ text: e }) => /* @__PURE__ */ d(a, { title: e })
};
function w() {
	let n = e(), r = t(), i = l(() => x((e, t, r) => e === "GET" ? n.get(t) : e === "POST" ? n.post(t, r) : n.del(t), S), [n]);
	return /* @__PURE__ */ d(b, {
		kit: C,
		client: i,
		notify: (e) => r(e),
		onStarted: () => window.open(_, "_blank", "noopener")
	});
}
export { S as CREW_API_BASE, C as crewKit, w as default };
