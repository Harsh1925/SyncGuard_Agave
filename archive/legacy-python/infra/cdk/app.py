#!/usr/bin/env python3
import aws_cdk as cdk
from stack import SyncGuardStack

app = cdk.App()
SyncGuardStack(app, "SyncGuardDemo")
app.synth()
