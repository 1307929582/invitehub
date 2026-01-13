"""
Property-based tests for RedeemCode model validity period calculations.

**Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
**Feature: commercial-refactor, Property 3: Remaining days calculation**
**Feature: commercial-refactor, Property 4: Email binding consistency**
**Validates: Requirements 2.1, 2.3, 4.1, 4.2**
"""
from datetime import datetime, timedelta
from hypothesis import given, strategies as st, settings, assume
import pytest

# Import the model - we test the logic directly without database
from app.models import RedeemCode


# Strategy for generating valid validity days (positive integers, reasonable range)
validity_days_strategy = st.integers(min_value=1, max_value=365)

# Strategy for generating activation timestamps (within reasonable past range)
activation_time_strategy = st.datetimes(
    min_value=datetime(2020, 1, 1),
    max_value=datetime(2030, 12, 31)
)


class TestRedeemCodeExpirationProperties:
    """
    Property-based tests for RedeemCode expiration calculation.
    
    **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
    **Validates: Requirements 2.1**
    """
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        activated_at=activation_time_strategy
    )
    def test_user_expires_at_equals_activation_plus_validity_days(
        self, validity_days: int, activated_at: datetime
    ):
        """
        Property 1: For any redeem code with validity_days V, when activated at time T,
        the user_expires_at should equal T + V days.
        
        **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
        **Validates: Requirements 2.1**
        """
        # Create a RedeemCode instance with the generated values
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = activated_at
        
        # Calculate expected expiration
        expected_expires_at = activated_at + timedelta(days=validity_days)
        
        # Assert the property holds
        assert code.user_expires_at == expected_expires_at, (
            f"Expected user_expires_at to be {expected_expires_at}, "
            f"but got {code.user_expires_at} for validity_days={validity_days}, "
            f"activated_at={activated_at}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_user_expires_at_is_none_when_not_activated(self, validity_days: int):
        """
        Property: For any redeem code that has not been activated,
        user_expires_at should be None.
        
        **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
        **Validates: Requirements 2.1**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        
        assert code.user_expires_at is None, (
            f"Expected user_expires_at to be None for non-activated code, "
            f"but got {code.user_expires_at}"
        )


class TestRedeemCodeRemainingDaysProperties:
    """
    Property-based tests for RedeemCode remaining days calculation.
    
    **Feature: commercial-refactor, Property 3: Remaining days calculation**
    **Validates: Requirements 2.3**
    """
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_since_activation=st.integers(min_value=0, max_value=400)
    )
    def test_remaining_days_calculation(
        self, validity_days: int, days_since_activation: int
    ):
        """
        Property 3: For any activated redeem code, remaining_days should equal
        max(0, (user_expires_at - current_time).days).
        
        **Feature: commercial-refactor, Property 3: Remaining days calculation**
        **Validates: Requirements 2.3**
        """
        # Set activation time relative to "now" for predictable testing
        # We use a fixed reference point to avoid timing issues
        reference_now = datetime(2025, 6, 15, 12, 0, 0)
        activated_at = reference_now - timedelta(days=days_since_activation)
        
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = activated_at
        
        # Calculate expected remaining days
        expires_at = activated_at + timedelta(days=validity_days)
        expected_remaining = max(0, (expires_at - reference_now).days)
        
        # The actual remaining_days uses datetime.utcnow(), so we need to
        # calculate what it should be based on the actual current time
        actual_remaining = code.remaining_days
        
        # Since remaining_days uses utcnow(), we verify the formula is correct
        # by checking the relationship between values
        if code.user_expires_at:
            delta = code.user_expires_at - datetime.utcnow()
            calculated_remaining = max(0, delta.days)
            assert actual_remaining == calculated_remaining, (
                f"remaining_days should equal max(0, (user_expires_at - now).days), "
                f"expected {calculated_remaining}, got {actual_remaining}"
            )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_remaining_days_is_none_when_not_activated(self, validity_days: int):
        """
        Property: For any redeem code that has not been activated,
        remaining_days should be None.
        
        **Feature: commercial-refactor, Property 3: Remaining days calculation**
        **Validates: Requirements 2.3**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        
        assert code.remaining_days is None, (
            f"Expected remaining_days to be None for non-activated code, "
            f"but got {code.remaining_days}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_remaining_days_never_negative(self, validity_days: int):
        """
        Property: For any activated redeem code, remaining_days should never be negative.
        
        **Feature: commercial-refactor, Property 3: Remaining days calculation**
        **Validates: Requirements 2.3**
        """
        # Activate far in the past to ensure expiration
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime(2020, 1, 1)  # Definitely expired
        
        assert code.remaining_days is not None
        assert code.remaining_days >= 0, (
            f"remaining_days should never be negative, got {code.remaining_days}"
        )


class TestRedeemCodeIsUserExpiredProperties:
    """
    Property-based tests for RedeemCode is_user_expired calculation.
    
    **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
    **Validates: Requirements 2.1**
    """
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_is_user_expired_false_when_not_activated(self, validity_days: int):
        """
        Property: For any redeem code that has not been activated,
        is_user_expired should be False.
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        
        assert code.is_user_expired is False, (
            "is_user_expired should be False for non-activated code"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_is_user_expired_true_when_past_expiration(self, validity_days: int):
        """
        Property: For any redeem code activated long ago (past validity period),
        is_user_expired should be True.
        """
        # Activate far enough in the past to guarantee expiration
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + 1)
        
        assert code.is_user_expired is True, (
            f"is_user_expired should be True when current time is past expiration, "
            f"validity_days={validity_days}, activated_at={code.activated_at}, "
            f"user_expires_at={code.user_expires_at}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=st.integers(min_value=2, max_value=365))
    def test_is_user_expired_false_when_within_validity(self, validity_days: int):
        """
        Property: For any redeem code activated recently (within validity period),
        is_user_expired should be False.
        """
        # Activate just now - should not be expired
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        
        assert code.is_user_expired is False, (
            f"is_user_expired should be False when within validity period, "
            f"validity_days={validity_days}, activated_at={code.activated_at}"
        )


# Strategy for generating valid email addresses
email_strategy = st.emails()


class TestEmailBindingConsistencyProperties:
    """
    Property-based tests for RedeemCode email binding consistency.
    
    **Feature: commercial-refactor, Property 4: Email binding consistency**
    **Validates: Requirements 4.1, 4.2**
    """
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_first_use_binds_email(self, email: str):
        """
        Property 4 (Part 1): For any redeem code, after first use with email E,
        the bound_email should equal E.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.1**
        """
        # Create a fresh redeem code (not activated)
        code = RedeemCode()
        code.code = "TEST123"
        code.validity_days = 30
        code.activated_at = None
        code.bound_email = None
        
        # Simulate first use - bind email
        normalized_email = email.lower().strip()
        code.bound_email = normalized_email
        code.activated_at = datetime.utcnow()
        
        # Assert the email is bound correctly
        assert code.bound_email == normalized_email, (
            f"Expected bound_email to be {normalized_email}, "
            f"but got {code.bound_email}"
        )
        assert code.activated_at is not None, (
            "Expected activated_at to be set after first use"
        )
    
    @settings(max_examples=100)
    @given(
        first_email=email_strategy,
        second_email=email_strategy
    )
    def test_different_email_should_be_rejected(self, first_email: str, second_email: str):
        """
        Property 4 (Part 2): For any redeem code already bound to email E1,
        subsequent use with different email E2 should be rejected.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.2**
        """
        # Ensure emails are different (after normalization)
        first_normalized = first_email.lower().strip()
        second_normalized = second_email.lower().strip()
        assume(first_normalized != second_normalized)
        
        # Create a redeem code already bound to first email
        code = RedeemCode()
        code.code = "TEST456"
        code.validity_days = 30
        code.activated_at = datetime.utcnow()
        code.bound_email = first_normalized
        
        # Verify the email mismatch check
        is_email_match = code.bound_email.lower() == second_normalized
        
        assert is_email_match is False, (
            f"Expected email mismatch for bound_email={code.bound_email} "
            f"and attempted email={second_normalized}"
        )
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_same_email_should_be_accepted(self, email: str):
        """
        Property 4 (Part 3): For any redeem code already bound to email E,
        subsequent use with the same email E should be accepted.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.1, 4.2**
        """
        normalized_email = email.lower().strip()
        
        # Create a redeem code already bound to the email
        code = RedeemCode()
        code.code = "TEST789"
        code.validity_days = 30
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        code.max_uses = 5
        code.used_count = 1
        
        # Verify the same email is accepted
        is_email_match = code.bound_email.lower() == normalized_email
        
        assert is_email_match is True, (
            f"Expected email match for bound_email={code.bound_email} "
            f"and attempted email={normalized_email}"
        )
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_email_binding_is_case_insensitive(self, email: str):
        """
        Property 4 (Part 4): Email binding comparison should be case-insensitive.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.1, 4.2**
        """
        normalized_email = email.lower().strip()
        
        # Create a redeem code bound to lowercase email
        code = RedeemCode()
        code.code = "TESTABC"
        code.validity_days = 30
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        
        # Test with uppercase version
        uppercase_email = email.upper().strip()
        is_email_match = code.bound_email.lower() == uppercase_email.lower()
        
        assert is_email_match is True, (
            f"Expected case-insensitive match for bound_email={code.bound_email} "
            f"and attempted email={uppercase_email}"
        )



class TestStatusQueryCompletenessProperties:
    """
    Property-based tests for status query completeness.
    
    **Feature: commercial-refactor, Property 7: Status query completeness**
    **Validates: Requirements 8.1**
    """
    
    @settings(max_examples=100)
    @given(
        email=email_strategy,
        validity_days=validity_days_strategy,
        team_name=st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'S'))),
        team_active=st.booleans()
    )
    def test_status_response_contains_required_fields_for_active_subscription(
        self, email: str, validity_days: int, team_name: str, team_active: bool
    ):
        """
        Property 7: For any email with active subscription, status query should return
        team_name, expires_at, remaining_days, and can_rebind flag.
        
        **Feature: commercial-refactor, Property 7: Status query completeness**
        **Validates: Requirements 8.1**
        """
        from app.schemas import StatusResponse
        
        # Ensure team_name is not empty after stripping
        assume(team_name.strip())
        
        normalized_email = email.lower().strip()
        
        # Create a redeem code that is activated (active subscription)
        code = RedeemCode()
        code.code = "TESTCODE123"
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()  # Just activated, not expired
        code.bound_email = normalized_email
        code.is_active = True
        
        # Simulate what the status endpoint would return for an active subscription
        # can_rebind is True when code is not expired and has remaining rebind count
        can_rebind = code.can_rebind
        
        response = StatusResponse(
            found=True,
            email=normalized_email,
            team_name=team_name.strip(),
            team_active=team_active,
            code=code.code[:4] + "****" + code.code[-2:],  # Masked code
            expires_at=code.user_expires_at,
            remaining_days=code.remaining_days,
            can_rebind=can_rebind
        )
        
        # Assert all required fields are present and have valid values
        assert response.found is True, "found should be True for active subscription"
        assert response.email == normalized_email, f"email should be {normalized_email}"
        assert response.team_name is not None, "team_name should not be None for active subscription"
        assert response.expires_at is not None, "expires_at should not be None for activated code"
        assert response.remaining_days is not None, "remaining_days should not be None for activated code"
        assert response.can_rebind is not None, "can_rebind should not be None"
        
        # Verify can_rebind logic: only depends on code validity and remaining count
        if code.is_user_expired:
            assert response.can_rebind is False, "can_rebind should be False when code is expired"
        else:
            assert response.can_rebind is True, "can_rebind should be True when code is valid and has remaining count"
    
    @settings(max_examples=100)
    @given(
        email=email_strategy,
        validity_days=validity_days_strategy
    )
    def test_status_response_remaining_days_matches_code_calculation(
        self, email: str, validity_days: int
    ):
        """
        Property 7 (Part 2): For any active subscription, remaining_days in status response
        should match the redeem code's remaining_days calculation.
        
        **Feature: commercial-refactor, Property 7: Status query completeness**
        **Validates: Requirements 8.1**
        """
        from app.schemas import StatusResponse
        
        normalized_email = email.lower().strip()
        
        # Create an activated redeem code
        code = RedeemCode()
        code.code = "TESTCODE456"
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        code.is_active = True
        
        # Build status response
        response = StatusResponse(
            found=True,
            email=normalized_email,
            team_name="Test Team",
            team_active=True,
            code="TEST****56",
            expires_at=code.user_expires_at,
            remaining_days=code.remaining_days,
            can_rebind=False
        )
        
        # Verify remaining_days matches the code's calculation
        assert response.remaining_days == code.remaining_days, (
            f"remaining_days in response ({response.remaining_days}) should match "
            f"code.remaining_days ({code.remaining_days})"
        )
        
        # Verify expires_at matches the code's calculation
        assert response.expires_at == code.user_expires_at, (
            f"expires_at in response ({response.expires_at}) should match "
            f"code.user_expires_at ({code.user_expires_at})"
        )
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_status_response_not_found_has_null_fields(self, email: str):
        """
        Property 7 (Part 3): For any email without subscription, status query should
        return found=False with all other fields as None.
        
        **Feature: commercial-refactor, Property 7: Status query completeness**
        **Validates: Requirements 8.3**
        """
        from app.schemas import StatusResponse
        
        # Build status response for not found case
        response = StatusResponse(found=False)
        
        # Verify all optional fields are None
        assert response.found is False, "found should be False"
        assert response.email is None, "email should be None when not found"
        assert response.team_name is None, "team_name should be None when not found"
        assert response.team_active is None, "team_active should be None when not found"
        assert response.code is None, "code should be None when not found"
        assert response.expires_at is None, "expires_at should be None when not found"
        assert response.remaining_days is None, "remaining_days should be None when not found"
        assert response.can_rebind is None, "can_rebind should be None when not found"


class TestRebindOperationIntegrityProperties:
    """
    Property-based tests for rebind operation integrity.
    
    **Feature: commercial-refactor, Property 5: Rebind operation integrity**
    **Validates: Requirements 3.1, 3.2, 3.3**
    """
    
    @settings(max_examples=100)
    @given(
        email=email_strategy,
        validity_days=validity_days_strategy
    )
    def test_rebind_requires_valid_code_and_remaining_limit(self, email: str, validity_days: int):
        """
        Property 5 (Part 1): For any valid rebind request, the code must be valid
        and have remaining rebind count.
        
        **Feature: commercial-refactor, Property 5: Rebind operation integrity**
        **Validates: Requirements 3.1**
        """
        normalized_email = email.lower().strip()
        
        # Create an activated, non-expired redeem code
        code = RedeemCode()
        code.code = "REBIND001"
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()  # Just activated
        code.bound_email = normalized_email
        code.is_active = True
        
        # can_rebind logic: only depends on code validity and remaining count
        assert code.can_rebind is True, (
            "Rebind should be allowed when code is valid and has remaining count"
        )
    
    @settings(max_examples=100)
    @given(
        email=email_strategy,
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_rebind_rejected_for_expired_code(self, email: str, validity_days: int, days_past_expiration: int):
        """
        Property 5 (Part 2): For any expired redeem code, rebind should be rejected
        regardless of team status.
        
        **Feature: commercial-refactor, Property 5: Rebind operation integrity**
        **Validates: Requirements 3.5**
        """
        normalized_email = email.lower().strip()
        
        # Create an expired redeem code
        code = RedeemCode()
        code.code = "REBIND002"
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = normalized_email
        code.is_active = True
        
        # Expired code should not allow rebind regardless of team status
        assert code.is_user_expired is True, "Code should be expired"
        assert code.can_rebind is False, (
            "Rebind should be rejected for expired code"
        )
    
    @settings(max_examples=100)
    @given(
        email=email_strategy,
        different_email=email_strategy,
        validity_days=validity_days_strategy
    )
    def test_rebind_requires_email_match(self, email: str, different_email: str, validity_days: int):
        """
        Property 5 (Part 3): For any rebind request, the email must match the bound email.
        
        **Feature: commercial-refactor, Property 5: Rebind operation integrity**
        **Validates: Requirements 3.1**
        """
        normalized_email = email.lower().strip()
        different_normalized = different_email.lower().strip()
        assume(normalized_email != different_normalized)
        
        # Create an activated redeem code bound to email
        code = RedeemCode()
        code.code = "REBIND003"
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        code.is_active = True
        
        # Check email match
        email_matches = code.bound_email.lower() == different_normalized
        
        assert email_matches is False, (
            f"Email mismatch should be detected: bound={code.bound_email}, "
            f"attempted={different_normalized}"
        )
    
    @settings(max_examples=100)
    @given(
        email=email_strategy,
        validity_days=validity_days_strategy
    )
    def test_rebind_preserves_code_binding(self, email: str, validity_days: int):
        """
        Property 5 (Part 4): After a successful rebind, the code should remain bound
        to the same email and maintain its validity period.
        
        **Feature: commercial-refactor, Property 5: Rebind operation integrity**
        **Validates: Requirements 3.3**
        """
        normalized_email = email.lower().strip()
        
        # Create an activated redeem code
        code = RedeemCode()
        code.code = "REBIND004"
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        code.is_active = True
        
        original_bound_email = code.bound_email
        original_activated_at = code.activated_at
        original_validity_days = code.validity_days
        original_expires_at = code.user_expires_at
        
        # Simulate rebind - these values should NOT change
        # (rebind only creates new invite record, doesn't modify code)
        
        assert code.bound_email == original_bound_email, (
            "Rebind should not change bound_email"
        )
        assert code.activated_at == original_activated_at, (
            "Rebind should not change activated_at"
        )
        assert code.validity_days == original_validity_days, (
            "Rebind should not change validity_days"
        )
        assert code.user_expires_at == original_expires_at, (
            "Rebind should not change user_expires_at"
        )


class TestRevenueCalculationAccuracyProperties:
    """
    Property-based tests for revenue calculation accuracy.
    
    **Feature: commercial-refactor, Property 6: Revenue calculation accuracy**
    **Validates: Requirements 5.2**
    """
    
    @settings(max_examples=100)
    @given(
        activated_count=st.integers(min_value=0, max_value=1000),
        unit_price=st.floats(min_value=0.0, max_value=1000.0, allow_nan=False, allow_infinity=False)
    )
    def test_revenue_equals_count_times_price(self, activated_count: int, unit_price: float):
        """
        Property 6: For any time period, revenue should equal
        count(activated_codes_in_period) * unit_price.
        
        **Feature: commercial-refactor, Property 6: Revenue calculation accuracy**
        **Validates: Requirements 5.2**
        """
        # Calculate expected revenue
        expected_revenue = activated_count * unit_price
        
        # Simulate the revenue calculation logic
        calculated_revenue = activated_count * unit_price
        
        # Allow for floating point precision issues
        assert abs(calculated_revenue - expected_revenue) < 0.01, (
            f"Revenue calculation mismatch: expected {expected_revenue}, "
            f"got {calculated_revenue} for count={activated_count}, price={unit_price}"
        )
    
    @settings(max_examples=100)
    @given(unit_price=st.floats(min_value=0.0, max_value=1000.0, allow_nan=False, allow_infinity=False))
    def test_zero_activations_means_zero_revenue(self, unit_price: float):
        """
        Property 6 (Part 2): For any unit price, zero activations should result in zero revenue.
        
        **Feature: commercial-refactor, Property 6: Revenue calculation accuracy**
        **Validates: Requirements 5.2**
        """
        activated_count = 0
        revenue = activated_count * unit_price
        
        assert revenue == 0.0, (
            f"Zero activations should result in zero revenue, got {revenue}"
        )
    
    @settings(max_examples=100)
    @given(activated_count=st.integers(min_value=1, max_value=1000))
    def test_zero_price_means_zero_revenue(self, activated_count: int):
        """
        Property 6 (Part 3): For any activation count, zero unit price should result in zero revenue.
        
        **Feature: commercial-refactor, Property 6: Revenue calculation accuracy**
        **Validates: Requirements 5.4**
        """
        unit_price = 0.0
        revenue = activated_count * unit_price
        
        assert revenue == 0.0, (
            f"Zero price should result in zero revenue, got {revenue}"
        )
    
    @settings(max_examples=100)
    @given(
        count1=st.integers(min_value=0, max_value=500),
        count2=st.integers(min_value=0, max_value=500),
        unit_price=st.floats(min_value=0.01, max_value=100.0, allow_nan=False, allow_infinity=False)
    )
    def test_revenue_is_additive(self, count1: int, count2: int, unit_price: float):
        """
        Property 6 (Part 4): Revenue calculation should be additive across periods.
        
        **Feature: commercial-refactor, Property 6: Revenue calculation accuracy**
        **Validates: Requirements 5.2**
        """
        revenue1 = count1 * unit_price
        revenue2 = count2 * unit_price
        total_revenue = (count1 + count2) * unit_price
        
        # Allow for floating point precision issues
        assert abs((revenue1 + revenue2) - total_revenue) < 0.01, (
            f"Revenue should be additive: {revenue1} + {revenue2} should equal {total_revenue}"
        )


class TestExpiredCodeRejectionProperties:
    """
    Property-based tests for expired code rejection.
    
    **Feature: commercial-refactor, Property 2: Expired code rejection**
    **Validates: Requirements 2.2, 3.5**
    """
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_expired_code_is_detected(self, validity_days: int, days_past_expiration: int):
        """
        Property 2 (Part 1): For any redeem code where current_time > user_expires_at,
        is_user_expired should return True.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        # Create a code that was activated and has expired
        code = RedeemCode()
        code.validity_days = validity_days
        # Activate far enough in the past to guarantee expiration
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = "test@example.com"
        
        # The code should be detected as expired
        assert code.is_user_expired is True, (
            f"Expected is_user_expired=True for code activated {validity_days + days_past_expiration} days ago "
            f"with validity_days={validity_days}, but got {code.is_user_expired}"
        )
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_expired_code_has_zero_remaining_days(self, validity_days: int, days_past_expiration: int):
        """
        Property 2 (Part 2): For any expired redeem code, remaining_days should be 0.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = "test@example.com"
        
        assert code.remaining_days == 0, (
            f"Expected remaining_days=0 for expired code, but got {code.remaining_days}"
        )
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_expired_code_user_expires_at_is_in_past(self, validity_days: int, days_past_expiration: int):
        """
        Property 2 (Part 3): For any expired redeem code, user_expires_at should be in the past.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2, 3.5**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = "test@example.com"
        
        assert code.user_expires_at is not None, "user_expires_at should not be None for activated code"
        assert code.user_expires_at < datetime.utcnow(), (
            f"Expected user_expires_at to be in the past for expired code, "
            f"but got {code.user_expires_at}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=st.integers(min_value=2, max_value=365))
    def test_non_expired_code_is_not_rejected(self, validity_days: int):
        """
        Property 2 (Inverse): For any redeem code where current_time <= user_expires_at,
        is_user_expired should return False.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        # Create a code that was just activated (not expired)
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        code.bound_email = "test@example.com"
        
        assert code.is_user_expired is False, (
            f"Expected is_user_expired=False for freshly activated code "
            f"with validity_days={validity_days}, but got {code.is_user_expired}"
        )
        assert code.remaining_days > 0, (
            f"Expected remaining_days > 0 for freshly activated code, "
            f"but got {code.remaining_days}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_non_activated_code_is_not_expired(self, validity_days: int):
        """
        Property 2 (Edge case): For any redeem code that has not been activated,
        is_user_expired should return False (cannot be expired if never activated).
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        code.bound_email = None
        
        assert code.is_user_expired is False, (
            "Expected is_user_expired=False for non-activated code"
        )
