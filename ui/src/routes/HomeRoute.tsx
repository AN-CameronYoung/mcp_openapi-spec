import React, { useEffect } from "react";
import SearchBar from "../components/SearchBar";
import SearchResults from "../components/SearchResults";
import SpecSelector from "../components/SpecSelector";
import SwaggerView from "../components/SwaggerView";
import useStore from "../store/store";

const HomeRoute: React.FC = () => {
	const { fetchSpecs } = useStore();

	useEffect(() => {
		fetchSpecs();
	}, [fetchSpecs]);

	return (
		<div className="min-h-screen flex flex-col">
			<SearchBar />
			<SearchResults />
			<SpecSelector />
			<div className="flex-1">
				<SwaggerView />
			</div>
		</div>
	);
};

export default HomeRoute;
