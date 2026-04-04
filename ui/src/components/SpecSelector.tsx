import React from "react";
import useStore from "../store/store";

const SpecSelector: React.FC = () => {
	const { specs, selectedSpec, setSelectedSpec } = useStore();

	if (specs.length === 0) return null;

	return (
		<div className="bg-custom-dark-100 px-5 py-2 border-b border-custom-dark-300 flex items-center gap-3">
			<label className="text-custom-text-300 text-sm">Spec:</label>
			<select
				value={selectedSpec}
				onChange={(e) => setSelectedSpec(e.target.value)}
				className="bg-custom-dark-200 border border-custom-dark-400 text-custom-text-100 text-sm px-3 py-1.5 rounded focus:outline-none focus:border-custom-accent"
			>
				{specs.map((spec) => (
					<option key={spec.url} value={spec.url}>
						{spec.name}
					</option>
				))}
			</select>
		</div>
	);
};

export default SpecSelector;
