"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../ui/alert-dialog";

interface CloseBranchConfirmProps {
	open: boolean;
	branchName: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * Confirmation dialog shown when closing a branch that contains messages.
 * Empty branches close immediately without invoking this component.
 */
export const CloseBranchConfirm = ({ open, branchName, onConfirm, onCancel }: CloseBranchConfirmProps): JSX.Element => {
	return (
		<AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Close {branchName}?</AlertDialogTitle>
					<AlertDialogDescription>
						This branch has messages. Closing it will discard them permanently.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onConfirm}>Close branch</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export default CloseBranchConfirm;
