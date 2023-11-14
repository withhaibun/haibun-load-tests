
Feature: A form and counter

    Backgrounds: counter

    When I have a valid random username <username>

    Go to the form webpage
    When I input <username> for user name
    And I click the button Submit

    Then I should see Success
    And the URI query parameter username is <username>
    
