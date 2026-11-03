window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-brand-official",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const MARK_GRADIENT = "nova-mark-gradient";

		/**
		 * The Nova spark: four concave points in one violet-to-cyan gradient, with
		 * a small satellite. Original artwork, drawn for this build.
		 */
		function NovaMark({ size = 24 }) {
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 48 48",
				fill: "none",
				"aria-hidden": true,
				style: { display: "block", filter: "drop-shadow(0 2px 8px rgba(109,94,252,.45))" },
			},
				h("defs", null,
					h("linearGradient", { id: MARK_GRADIENT, x1: 6, y1: 4, x2: 42, y2: 44, gradientUnits: "userSpaceOnUse" },
						h("stop", { offset: 0, stopColor: "#C4B5FD" }),
						h("stop", { offset: 0.52, stopColor: "#6D5EFC" }),
						h("stop", { offset: 1, stopColor: "#22D3EE" }))),
				h("path", {
					d: "M24 2.5C26 15 33 22 45.5 24 33 26 26 33 24 45.5 22 33 15 26 2.5 24 15 22 22 15 24 2.5Z",
					fill: `url(#${MARK_GRADIENT})`,
				}),
				h("circle", { cx: 37.6, cy: 10.4, r: 2.7, fill: "#5EE7F7", opacity: 0.9 }));
		}

		function NovaName() {
			return h("span", {
				style: {
					fontWeight: 650,
					fontSize: 14,
					letterSpacing: "-.02em",
					background: "linear-gradient(100deg,#f4f1ff 0%,#c4b5fd 20%,#8b7cff 42%,#5ee7f7 66%,#f4f1ff 100%)",
					backgroundSize: "220% auto",
					WebkitBackgroundClip: "text",
					backgroundClip: "text",
					color: "transparent",
					animation: "nova-ui-shimmer 8s linear infinite",
					filter: "drop-shadow(0 0 10px rgba(139,124,255,.35))",
				},
			}, "Nova Bots");
		}

		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
				yield ctx.slots.register({ name: "sidebar.brand.mark" }, NovaMark);
				yield ctx.slots.register({ name: "sidebar.brand.name" }, NovaName);
			}));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
