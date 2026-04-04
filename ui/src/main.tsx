import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import HomeRoute from "./routes/HomeRoute";
import "./styles/globals.css";

const router = createBrowserRouter([
	{
		path: "/",
		element: <HomeRoute />,
	},
	{
		path: "/docs",
		element: <HomeRoute />,
	},
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<RouterProvider router={router} />
	</React.StrictMode>,
);
